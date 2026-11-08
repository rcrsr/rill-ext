/**
 * Extension factory for Azure AI Foundry integration.
 * Creates extension instance with config validation, AzureOpenAI client,
 * usage accumulator, and idempotent disposal.
 */

import {
  RuntimeError,
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
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  disposedHaltFor,
  throwProviderHalt,
  buildResponseMessages,
  normalizePrompt,
  type Message,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { FoundryConfig, FoundryDisposalRef } from './types.js';
import { createAzureOpenAIClient } from './client.js';
import { detectFoundryError } from './errors.js';
import { callShield, createAutoShieldMiddleware } from './safety.js';
import { callGround } from './grounding.js';
import { callSearch } from './search.js';
import { buildGenerateFn } from './generate-fn.js';
import { haltInvalid, messagesToOpenAI } from './message-helpers.js';
import type { FoundryScope } from './scope.js';
import { buildToolLoopFn } from './tool-loop-fn.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 30000;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Azure AI Foundry extension instance.
 * Validates endpoint and auth at factory time; defers inference, contentSafety,
 * grounding, and search validation to first use.
 *
 * @param config - Extension configuration
 * @returns ExtensionFactoryResult with 10 host functions + dispose
 * @throws RuntimeError for invalid endpoint or auth
 */
export async function createFoundryExtension(
  config: FoundryConfig
): Promise<ExtensionFactoryResult> {
  // Validate endpoint is non-empty
  if (!config.endpoint || config.endpoint.trim().length === 0) {
    throw new RuntimeError('RILL-R001', 'foundry: endpoint is required');
  }

  // Validate auth is present
  if (!config.auth) {
    throw new RuntimeError('RILL-R001', 'foundry: auth is required');
  }

  // Validate auth.type
  if (config.auth.type !== 'api-key' && config.auth.type !== 'entra') {
    throw new RuntimeError(
      'RILL-R001',
      "foundry: auth.type must be 'api-key' or 'entra'"
    );
  }

  // Create the AzureOpenAI client (may be unused if inference not configured)
  // We pass inference as undefined when absent — the client still works for auth setup
  const client = await createAzureOpenAIClient(
    config.endpoint,
    config.auth,
    config.inference
  );

  // Extract inference config values (may be absent)
  const inference = config.inference;
  const factoryModel = inference?.model;
  const factoryTemperature = inference?.temperature;
  const factoryMaxTokens = inference?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = inference?.system;
  const factoryEmbedModel = inference?.embedModel;
  const factoryTimeout = inference?.timeout ?? DEFAULT_TIMEOUT;

  // Suppress unused variable warning
  void factoryTimeout;

  // ============================================================
  // DISPOSAL STATE
  // ============================================================

  // Inline AbortController per D-3 (follow llm-openai precedent, no import from ext-search-shared)
  let abortController: AbortController | undefined = new AbortController();

  // Disposal state shared with safety/grounding/search modules: the flag marks
  // disposal and the signal aborts their in-flight requests.
  const disposedRef: FoundryDisposalRef = {
    value: false,
    signal: abortController.signal,
  };

  // ============================================================
  // AUTO-SHIELD MIDDLEWARE
  // ============================================================

  // Create once; used to wrap message, generate, and tool_loop callbacks.
  const autoShieldMiddleware =
    config.contentSafety?.autoShield === true
      ? createAutoShieldMiddleware(config, config.auth, disposedRef)
      : null;

  // ============================================================
  // USAGE ACCUMULATOR
  // ============================================================

  let usageInputTokens = 0;
  let usageOutputTokens = 0;

  // Helper: increment usage counters after an LLM call
  function accumulateUsage(input: number, output: number): void {
    usageInputTokens += input;
    usageOutputTokens += output;
  }

  // ============================================================
  // INFERENCE GUARD
  // ============================================================

  /**
   * Guard: throws when inference config is absent or incomplete.
   * Called at the top of every LLM host function.
   */
  function assertInference(ctx: RuntimeContext): {
    model: string;
    apiVersion: string;
  } {
    if (!inference) {
      throw haltInvalid(
        ctx,
        'UNAVAILABLE',
        'inference_unconfigured',
        'foundry: inference not configured'
      );
    }
    // model is required
    if (!inference.model || inference.model.trim().length === 0) {
      throw haltInvalid(
        ctx,
        'INVALID_INPUT',
        'model_missing',
        'foundry: model is required'
      );
    }
    // apiVersion is required
    if (!inference.apiVersion || inference.apiVersion.trim().length === 0) {
      throw haltInvalid(
        ctx,
        'INVALID_INPUT',
        'apiversion_missing',
        'foundry: inference.apiVersion is required'
      );
    }
    return { model: inference.model, apiVersion: inference.apiVersion };
  }

  // ============================================================
  // DISPOSAL GUARD
  // ============================================================

  function assertNotDisposed(ctx: RuntimeContext): void {
    if (!abortController) {
      throw haltInvalid(
        ctx,
        'DISPOSED',
        'extension_disposed',
        'foundry: extension disposed'
      );
    }
  }

  // ============================================================
  // CANCELLATION CLASSIFIER
  // ============================================================

  /**
   * Returns the #DISPOSED halt when dispose() cancelled the call, otherwise
   * undefined. An error that happened before dispose keeps its own class.
   */
  function cancelledByDispose(
    ctx: RuntimeContext,
    error: unknown
  ): RuntimeHaltSignal | undefined {
    return disposedHaltFor(
      ctx,
      'foundry',
      error,
      abortController === undefined
    );
  }

  // Single failure classifier for host-function catch blocks.
  function classifyError(
    ctx: RuntimeContext,
    error: unknown
  ): RuntimeError | RuntimeHaltSignal {
    return (
      cancelledByDispose(ctx, error) ??
      (error instanceof RuntimeHaltSignal || error instanceof RuntimeError
        ? error
        : new RuntimeHaltSignal(
            mapProviderError(ctx, 'Foundry', error, detectFoundryError),
            true
          ))
    );
  }

  // ============================================================
  // DISPOSE
  // ============================================================

  const dispose = (): Promise<void> => {
    // Idempotent: second call is no-op
    if (!abortController) {
      return Promise.resolve();
    }

    try {
      abortController.abort();
    } catch {
      // ignore abort errors
    }

    abortController = undefined;
    disposedRef.value = true;
    return Promise.resolve();
  };

  // ============================================================
  // LLM HOST FUNCTIONS
  // ============================================================

  // Accessors keep abortController and the usage counters single-sourced
  // across modules.
  const scope: FoundryScope = {
    client,
    model: factoryModel,
    temperature: factoryTemperature,
    maxTokens: factoryMaxTokens,
    system: factorySystem,
    autoShield: autoShieldMiddleware,
    assertNotDisposed,
    assertInference,
    cancelledByDispose,
    classifyError,
    accumulateUsage,
    getAbortSignal: (ctx) => {
      assertNotDisposed(ctx);
      return (abortController as AbortController).signal;
    },
  };

  const fnDict: {
    message: RillFunction;
    embed: RillFunction;
    embed_batch: RillFunction;
    tool_loop: RillFunction;
    generate: RillFunction;
  } = {
    // -------------------------------------------------------
    // message
    // -------------------------------------------------------
    message: {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        p.dict(
          'options',
          undefined,
          {},
          {
            system: { type: { kind: 'string' }, defaultValue: '' },
            max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
          }
        ),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx as RuntimeContext);
        assertInference(ctx as RuntimeContext);

        const rawPrompt = args['prompt'] as RillValue;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        const normalizedResult = normalizePrompt(
          rawPrompt,
          ctx as RuntimeContext
        );
        if (!Array.isArray(normalizedResult)) {
          throw new RuntimeHaltSignal(normalizedResult, true);
        }
        const normalizedPrompt = normalizedResult as Message[];

        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        const inputMessages: Message[] = system
          ? [
              { role: 'system', parts: [{ type: 'text', text: system }] },
              ...normalizedPrompt,
            ]
          : normalizedPrompt;

        const apiMessages = messagesToOpenAI(inputMessages);

        const runner = client.chat.completions.stream(
          {
            model: factoryModel!,
            max_completion_tokens: maxTokens,
            messages: apiMessages,
            stream_options: { include_usage: true },
            ...(factoryTemperature !== undefined
              ? { temperature: factoryTemperature }
              : {}),
          },
          { signal: abortController!.signal }
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            const cancelled = cancelledByDispose(ctx as RuntimeContext, error);
            if (cancelled) throw cancelled;
            if (error instanceof RuntimeHaltSignal) throw error;
            throwProviderHalt(
              ctx as RuntimeContext,
              'Foundry',
              error,
              detectFoundryError
            );
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalChatCompletion();
            const content = response.choices[0]?.message?.content ?? '';
            const inputTokens = response.usage?.prompt_tokens ?? 0;
            const outputTokens = response.usage?.completion_tokens ?? 0;

            accumulateUsage(inputTokens, outputTokens);

            const result = {
              content,
              model: response.model,
              usage: { input: inputTokens, output: outputTokens },
              stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
              id: response.id,
              messages: buildResponseMessages(inputMessages, [
                { type: 'text', text: content },
              ]),
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:message',
              subsystem: 'extension:foundry',
              duration,
              model: response.model,
              inputTokens,
              outputTokens,
            });

            return result as unknown as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError: RuntimeError | RuntimeHaltSignal = classifyError(
              ctx as RuntimeContext,
              error
            );
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:message:error',
              subsystem: 'extension:foundry',
              model: factoryModel ?? '',
              error:
                rillError instanceof RuntimeHaltSignal
                  ? getStatus(rillError.value).message
                  : rillError.message,
              duration,
            });
            throw rillError;
          }
        };

        const retType = {
          kind: 'dict' as const,
          fields: {
            content: { type: { kind: 'string' as const } },
            model: { type: { kind: 'string' as const } },
            usage: {
              type: {
                kind: 'dict' as const,
                fields: {
                  input: { type: { kind: 'number' as const } },
                  output: { type: { kind: 'number' as const } },
                },
              },
            },
            stop_reason: { type: { kind: 'string' as const } },
            id: { type: { kind: 'string' as const } },
            messages: {
              type: {
                kind: 'list' as const,
                element: { kind: 'dict' as const },
              },
            },
          },
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => {
            runner.abort();
          },
          chunkType: { kind: 'string' },
          retType,
        });
      },
      annotations: { description: 'Send single message to Azure AI Foundry' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: {
          kind: 'dict',
          fields: {
            content: { type: { kind: 'string' } },
            model: { type: { kind: 'string' } },
            usage: {
              type: {
                kind: 'dict',
                fields: {
                  input: { type: { kind: 'number' } },
                  output: { type: { kind: 'number' } },
                },
              },
            },
            stop_reason: { type: { kind: 'string' } },
            id: { type: { kind: 'string' } },
            messages: { type: { kind: 'list', element: { kind: 'dict' } } },
          },
        },
      }),
    },

    // -------------------------------------------------------
    // embed
    // -------------------------------------------------------
    embed: {
      params: [p.str('text')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        assertNotDisposed(ctx as RuntimeContext);
        assertInference(ctx as RuntimeContext);

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
              ctx as RuntimeContext,
              'PROTOCOL',
              'empty_embedding',
              'foundry: empty embedding returned'
            );
          }

          const float32Data = new Float32Array(embeddingData);
          const vector = createVector(float32Data, factoryEmbedModel);

          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            duration,
            model: factoryEmbedModel,
            tokenCount: response.usage?.total_tokens ?? 0,
          });

          return vector as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal = classifyError(
            ctx as RuntimeContext,
            error
          );
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            error:
              rillError instanceof RuntimeHaltSignal
                ? getStatus(rillError.value).message
                : rillError.message,
            duration,
          });
          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vector for text' },
      returnType: structureToTypeValue({ kind: 'vector' }),
    },

    // -------------------------------------------------------
    // embed_batch
    // -------------------------------------------------------
    embed_batch: {
      params: [p.list('texts')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        assertNotDisposed(ctx as RuntimeContext);
        assertInference(ctx as RuntimeContext);

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
            if (!embeddingData || embeddingData.length === 0) {
              throw haltInvalid(
                ctx as RuntimeContext,
                'PROTOCOL',
                'empty_embedding',
                'foundry: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embeddingData);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

          const duration = Date.now() - startTime;
          const firstVector = vectors[0];
          const dimensions =
            firstVector && isVector(firstVector) ? firstVector.data.length : 0;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            duration,
            model: factoryEmbedModel,
            tokenCount: response.usage?.total_tokens ?? 0,
            dimensions,
            count: vectors.length,
          });

          return vectors as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal = classifyError(
            ctx as RuntimeContext,
            error
          );
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            error:
              rillError instanceof RuntimeHaltSignal
                ? getStatus(rillError.value).message
                : rillError.message,
            duration,
          });
          throw rillError;
        }
      },
      annotations: {
        description: 'Generate embedding vectors for multiple texts',
      },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'vector' },
      }),
    },

    tool_loop: buildToolLoopFn(scope),
    generate: buildGenerateFn(scope),
  };

  // ============================================================
  // AUTO-SHIELD WRAPPING (message, generate)
  // ============================================================

  // When autoShield is enabled, wrap the outer fn for message and generate
  // so the shield check runs before each LLM call.
  // embed and embed_batch are excluded per spec.
  // tool_loop per-iteration shielding is handled inside the callbacks (see tool_loop.fn).

  function wrapWithShield(
    rillFn: typeof fnDict.message,
    triggeredBy: string
  ): typeof fnDict.message {
    if (!autoShieldMiddleware) {
      return rillFn;
    }
    const shield = autoShieldMiddleware;
    return {
      ...rillFn,
      fn: async (args, ctx): Promise<RillValue> => {
        return await shield(
          args as Record<string, RillValue>,
          ctx as RuntimeContext,
          async (shieldArgs, shieldCtx) => {
            const result = rillFn.fn(shieldArgs, shieldCtx);
            return result instanceof Promise ? await result : result;
          },
          triggeredBy
        );
      },
    };
  }

  const messageFn = wrapWithShield(fnDict.message, 'message');
  const generateFn = wrapWithShield(fnDict.generate, 'generate');

  // Apply LlmExtensionContract satisfies check at compile time
  const callableDict = {
    message: toCallable(messageFn),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(generateFn),
  } satisfies LlmExtensionContract;

  // ============================================================
  // ADDITIONAL HOST FUNCTIONS
  // ============================================================

  const usageFn: RillFunction = {
    params: [],
    fn: (_args, _ctx): RillValue => {
      assertNotDisposed(_ctx as RuntimeContext);
      return {
        input_tokens: usageInputTokens,
        output_tokens: usageOutputTokens,
      } as RillValue;
    },
    annotations: {
      description: 'Return accumulated token usage since factory creation',
    },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        input_tokens: { type: { kind: 'number' } },
        output_tokens: { type: { kind: 'number' } },
      },
    }),
  };

  const shieldFn: RillFunction = {
    params: [p.str('text'), p.list('documents')],
    fn: async (args, ctx): Promise<RillValue> => {
      const text = args['text'] as string;
      const documents = (args['documents'] ?? []) as Array<RillValue>;
      const stringDocs = documents.filter(
        (d): d is string => typeof d === 'string'
      );
      return await callShield(
        text,
        stringDocs,
        config,
        config.auth,
        ctx as RuntimeContext,
        disposedRef
      );
    },
    annotations: {
      description: 'Evaluate text for prompt attacks via Azure Content Safety',
    },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        safe: { type: { kind: 'boolean' } },
        analysis: { type: { kind: 'dict' } },
      },
    }),
  };

  const groundFn: RillFunction = {
    params: [p.str('query')],
    fn: async (args, ctx): Promise<RillValue> => {
      const query = args['query'] as string;
      return await callGround(
        query,
        config,
        client,
        ctx as RuntimeContext,
        disposedRef
      );
    },
    annotations: {
      description: 'Ground a query via Bing using Azure AI Foundry',
    },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        answer: { type: { kind: 'string' } },
        citations: { type: { kind: 'list', element: { kind: 'dict' } } },
      },
    }),
  };

  const searchFn: RillFunction = {
    params: [
      p.str('query'),
      p.dict(
        'options',
        undefined,
        {},
        {
          index: { type: { kind: 'string' }, defaultValue: '' },
          query_type: { type: { kind: 'string' }, defaultValue: '' },
          top: { type: { kind: 'number' }, defaultValue: 10 },
          filter: { type: { kind: 'string' }, defaultValue: '' },
        }
      ),
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      const query = args['query'] as string;
      const options = (args['options'] ?? {}) as Record<string, RillValue>;
      return await callSearch(
        query,
        options,
        config,
        config.auth,
        ctx as RuntimeContext,
        disposedRef
      );
    },
    annotations: { description: 'Search Azure AI Search indexes' },
    returnType: structureToTypeValue({
      kind: 'list',
      element: { kind: 'dict' },
    }),
  };

  // ============================================================
  // RETURN VALUE
  // ============================================================

  const value = {
    ...callableDict,
    usage: toCallable(usageFn),
    shield: toCallable(shieldFn),
    ground: toCallable(groundFn),
    search: toCallable(searchFn),
  };

  return { value: value as unknown as RillValue, dispose };
}
