/**
 * Extension factory for OpenAI API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 *
 * Routing: o-series reasoning models (o1, o3, o-mini, o4, etc.) use the Responses API.
 * Standard models (gpt-*, text-*, etc.) use Chat Completions.
 * Routing is fixed at factory init.
 */

import OpenAI from 'openai';
import {
  RuntimeHaltSignal,
  createRillStream,
  emitExtensionEvent,
  createVector,
  isVector,
  getStatus,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  type LlmExtensionContract,
  validateApiKey,
  validateModel,
  validateTemperature,
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  throwIfCancelledByDispose,
  throwProviderHalt,
  buildResponseMessages,
  normalizePrompt,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
  type Message,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import { buildGenerateFn } from './generate-fn.js';
import type { OpenAIScope } from './scope.js';
import { buildToolLoopFnCC, buildToolLoopFnResponses } from './tool-loop-fn.js';
import type { OpenAIExtensionConfig } from './types.js';
import {
  DEFAULT_MAX_COMPLETION_TOKENS,
  O_SERIES_PATTERN,
  RESERVED_KEYS_OPENAI,
  VERB_STREAM_RET_TYPE,
  canonicalToCC,
  canonicalToResponsesAPI,
  ccChoiceToCanonical,
  detectOpenAIError,
  haltInvalid,
  responsesAPIToCanonical,
} from './wire-format.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Create OpenAI extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * Model routing:
 * - o-series (o1, o3, o4-mini, etc.) → Responses API
 * - Standard models (gpt-*, etc.) → Chat Completions
 * Routing is fixed for instance lifetime.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, embed, embed_batch, tool_loop, generate and dispose
 * @throws RuntimeError('RILL-R001', ...) for invalid configuration
 */
export function createOpenAIExtension(
  config: OpenAIExtensionConfig
): ExtensionFactoryResult {
  // Validate factory max_turns BEFORE client creation
  validateMaxTurns(config.max_turns);

  // Validate factory max_errors BEFORE client creation; reject 0/negative/non-integer
  validateMaxErrors(config.max_errors);

  // Validate extra keys BEFORE client creation
  validateExtraKeys(config.extra, RESERVED_KEYS_OPENAI);

  // Validate required fields
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Detect model class at factory init; routing fixed for instance lifetime
  const isOSeries = O_SERIES_PATTERN.test(config.model);

  // Instantiate SDK client at factory time
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    maxRetries: config.max_retries,
    timeout: config.timeout,
  });

  // Extract config values for closures
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;
  const factoryMaxTurns = config.max_turns;
  const factoryMaxErrors = config.max_errors;
  const factoryExtra = config.extra;

  // AbortController for cancelling pending requests
  let abortController: AbortController | undefined = new AbortController();

  const dispose = (): Promise<void> => {
    try {
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to abort OpenAI requests: ${message}`);
    }
    return Promise.resolve();
  };

  // After dispose() the abortController is cleared. Called at the top of each
  // host function so later calls report #DISPOSED.
  function assertNotDisposed(ctx: RuntimeContext): void {
    if (!abortController) {
      throw haltInvalid(
        ctx,
        'DISPOSED',
        'extension_disposed',
        'openai: extension disposed'
      );
    }
  }

  // Called first in every catch block. Reports #DISPOSED only when dispose()
  // is what cancelled the call; an error that happened before dispose keeps its
  // original classification. Emits openai:error when startTime is supplied.
  function haltIfCancelledByDispose(
    ctx: RuntimeContext,
    error: unknown,
    startTime?: number
  ): void {
    throwIfCancelledByDispose(
      ctx,
      'openai',
      error,
      abortController === undefined,
      () => {
        if (startTime !== undefined) {
          emitExtensionEvent(ctx, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: 'openai: extension disposed',
            duration: Date.now() - startTime,
          });
        }
      }
    );
  }

  // Accessors keep abortController a single source of truth across modules.
  const scope: OpenAIScope = {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    maxTurns: factoryMaxTurns,
    maxErrors: factoryMaxErrors,
    extra: factoryExtra,
    assertNotDisposed,
    haltIfCancelledByDispose,
    getAbortSignal: (ctx) => {
      assertNotDisposed(ctx);
      return (abortController as AbortController).signal;
    },
  };

  // ============================================================
  // HOST FUNCTION: message (Chat Completions path)
  // ============================================================

  function makeMessageFnCC(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx);
        const rawPrompt = args['prompt'] as RillValue;

        // Normalize prompt (string or message list) → canonical Message[]
        const normalizedCC = normalizePrompt(rawPrompt, ctx);
        if (!Array.isArray(normalizedCC)) {
          throw new RuntimeHaltSignal(normalizedCC, true);
        }
        const normalized = normalizedCC as Message[];

        const inputMessages: Message[] =
          factorySystem !== undefined && factorySystem !== ''
            ? [
                {
                  role: 'system',
                  parts: [{ type: 'text', text: factorySystem }],
                },
                ...normalized,
              ]
            : normalized;

        const apiMessages = canonicalToCC(inputMessages);

        const runner = client.chat.completions.stream(
          {
            model: factoryModel,
            max_completion_tokens: factoryMaxTokens,
            messages: apiMessages,
            stream_options: { include_usage: true },
            ...(factoryTemperature !== undefined
              ? { temperature: factoryTemperature }
              : {}),
            ...factoryExtra,
          } as OpenAI.ChatCompletionCreateParamsStreaming,
          { signal: abortController!.signal }
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta !== undefined && delta !== null && delta !== '') {
                yield delta;
              }
            }
          } catch (error: unknown) {
            // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
            haltIfCancelledByDispose(ctx, error);
            throwProviderHalt(ctx, 'OpenAI', error, detectOpenAIError);
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalChatCompletion();
            const assistantMsg = ccChoiceToCanonical(response.choices[0]!);
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: response.model,
              usage: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
              },
              stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
              id: response.id,
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx, {
              event: 'openai:message',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
            });

            return result;
          } catch (error: unknown) {
            // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            runner.abort();
          },
          chunkType: { kind: 'string' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: {
        description: 'Send message to OpenAI Chat Completions API',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // HOST FUNCTION: message (Responses API path)
  // ============================================================

  function makeMessageFnResponses(): RillFunction {
    return {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx);
        const rawPrompt = args['prompt'] as RillValue;

        const normalizedRaw1 = normalizePrompt(rawPrompt, ctx);
        if (!Array.isArray(normalizedRaw1)) {
          throw new RuntimeHaltSignal(normalizedRaw1, true);
        }
        const normalized1 = normalizedRaw1 as Message[];

        const inputMessages: Message[] =
          factorySystem !== undefined && factorySystem !== ''
            ? [
                {
                  role: 'system',
                  parts: [{ type: 'text', text: factorySystem }],
                },
                ...normalized1,
              ]
            : normalized1;

        const { input, instructions } = canonicalToResponsesAPI(inputMessages);

        const baseParams: Record<string, unknown> = {
          model: factoryModel,
          max_output_tokens: factoryMaxTokens,
          input,
          ...(instructions !== undefined ? { instructions } : {}),
          ...(factoryTemperature !== undefined
            ? { temperature: factoryTemperature }
            : {}),
          ...factoryExtra,
        };

        // One runner backs both the stream and the resolved result so a single
        // message() call costs one request (not two) and dispose can abort it.
        const runner = client.responses.stream(
          {
            ...baseParams,
            stream: true,
          },
          { signal: abortController!.signal }
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const event of runner) {
              const e = event as { type?: string; delta?: string };
              if (
                e.type === 'response.output_text.delta' &&
                e.delta !== undefined &&
                e.delta !== ''
              ) {
                yield e.delta;
              }
            }
          } catch (error: unknown) {
            // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
            haltIfCancelledByDispose(ctx, error);
            throwProviderHalt(ctx, 'OpenAI', error, detectOpenAIError);
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalResponse();

            const assistantMsg = responsesAPIToCanonical(response);
            const responseMessages = buildResponseMessages(
              inputMessages,
              assistantMsg.parts
            );

            const result = {
              messages: responseMessages as unknown as RillValue,
              model: response.model,
              usage: {
                input: response.usage?.input_tokens ?? 0,
                output: response.usage?.output_tokens ?? 0,
              },
              stop_reason: response.status ?? 'completed',
              id: response.id,
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx, {
              event: 'openai:message',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
            });

            return result;
          } catch (error: unknown) {
            // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx,
              'OpenAI',
              error,
              detectOpenAIError
            );
            emitExtensionEvent(ctx, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            runner.abort();
          },
          chunkType: { kind: 'string' },
          retType: VERB_STREAM_RET_TYPE,
        });
      },
      annotations: { description: 'Send message to OpenAI Responses API' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: VERB_STREAM_RET_TYPE,
      }),
    };
  }

  // ============================================================
  // HOST FUNCTION: embed
  // ============================================================

  const embedFn: RillFunction = {
    params: [p.str('text')],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx);
      const startTime = Date.now();

      try {
        const text = args['text'] as string;

        validateEmbedText(text.trim());
        validateEmbedModel(factoryEmbedModel);

        const response = await client.embeddings.create(
          {
            model: factoryEmbedModel,
            input: text,
            encoding_format: 'float',
          },
          { signal: abortController!.signal }
        );

        const embeddingData = response.data[0]?.embedding;
        if (!embeddingData || embeddingData.length === 0) {
          throw haltInvalid(
            ctx,
            'PROTOCOL',
            'empty_embedding_response',
            'OpenAI: empty embedding returned'
          );
        }

        const float32Data = new Float32Array(embeddingData);
        const vector = createVector(float32Data, factoryEmbedModel);

        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx, {
          event: 'openai:embed',
          subsystem: 'extension:openai',
          duration,
          model: factoryEmbedModel,
          dimensions: float32Data.length,
        });

        return vector;
      } catch (error: unknown) {
        // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
        haltIfCancelledByDispose(ctx, error, startTime);
        const duration = Date.now() - startTime;

        if (error instanceof RuntimeHaltSignal) {
          emitExtensionEvent(ctx, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(error.value).message,
            duration,
          });
          throw error;
        }

        const invalid = mapProviderError(
          ctx,
          'OpenAI',
          error,
          detectOpenAIError
        );
        emitExtensionEvent(ctx, {
          event: 'openai:error',
          subsystem: 'extension:openai',
          error: getStatus(invalid).message,
          duration,
        });
        throw new RuntimeHaltSignal(invalid, true);
      }
    },
    annotations: { description: 'Generate embedding vector for text' },
    returnType: structureToTypeValue({ kind: 'vector' }),
  };

  // ============================================================
  // HOST FUNCTION: embed_batch
  // ============================================================

  const embedBatchFn: RillFunction = {
    params: [p.list('texts')],
    fn: async (args, ctx): Promise<RillValue> => {
      assertNotDisposed(ctx);
      const startTime = Date.now();

      try {
        const texts = args['texts'] as Array<RillValue>;

        if (texts.length === 0) {
          return [] as RillValue;
        }

        validateEmbedModel(factoryEmbedModel);

        const stringTexts = validateEmbedBatch(texts);

        const response = await client.embeddings.create(
          {
            model: factoryEmbedModel,
            input: stringTexts,
            encoding_format: 'float',
          },
          { signal: abortController!.signal }
        );

        const vectors: RillValue[] = [];
        for (const embeddingItem of response.data) {
          const embeddingData = embeddingItem.embedding;
          if (
            embeddingData === undefined ||
            embeddingData === null ||
            embeddingData.length === 0
          ) {
            throw haltInvalid(
              ctx,
              'PROTOCOL',
              'empty_embedding_response',
              'OpenAI: empty embedding returned'
            );
          }
          const float32Data = new Float32Array(embeddingData);
          vectors.push(createVector(float32Data, factoryEmbedModel));
        }

        const duration = Date.now() - startTime;
        const firstVector = vectors[0];
        const dimensions =
          firstVector !== undefined && isVector(firstVector)
            ? firstVector.data.length
            : 0;
        emitExtensionEvent(ctx, {
          event: 'openai:embed_batch',
          subsystem: 'extension:openai',
          duration,
          model: factoryEmbedModel,
          dimensions,
          count: vectors.length,
        });

        return vectors;
      } catch (error: unknown) {
        // A call cancelled by dispose() reports #DISPOSED; other errors keep their class.
        haltIfCancelledByDispose(ctx, error, startTime);
        const duration = Date.now() - startTime;

        if (error instanceof RuntimeHaltSignal) {
          emitExtensionEvent(ctx, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(error.value).message,
            duration,
          });
          throw error;
        }

        const invalid = mapProviderError(
          ctx,
          'OpenAI',
          error,
          detectOpenAIError
        );
        emitExtensionEvent(ctx, {
          event: 'openai:error',
          subsystem: 'extension:openai',
          error: getStatus(invalid).message,
          duration,
        });
        throw new RuntimeHaltSignal(invalid, true);
      }
    },
    annotations: {
      description: 'Generate embedding vectors for multiple texts',
    },
    returnType: structureToTypeValue({
      kind: 'list',
      element: { kind: 'vector' },
    }),
  };

  // ============================================================
  // ASSEMBLE RESULT
  // ============================================================

  // Select routing implementations based on model class (fixed at factory init)
  const messageFn = isOSeries ? makeMessageFnResponses() : makeMessageFnCC();
  const toolLoopFn = isOSeries
    ? buildToolLoopFnResponses(scope)
    : buildToolLoopFnCC(scope);
  const generateFn = buildGenerateFn(scope);

  const fnDict: {
    message: RillFunction;
    embed: RillFunction;
    embed_batch: RillFunction;
    tool_loop: RillFunction;
    generate: RillFunction;
  } = {
    message: messageFn,
    embed: embedFn,
    embed_batch: embedBatchFn,
    tool_loop: toolLoopFn,
    generate: generateFn,
  };

  const callableDict = {
    message: toCallable(fnDict.message),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(fnDict.generate),
  } satisfies LlmExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
