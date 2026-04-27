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
  type TypeStructure,
} from '@rcrsr/rill';
import {
  type LlmExtensionContract,
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  throwProviderHalt,
  executeToolLoop,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type OpenAI from 'openai';
import type { FoundryConfig } from './types.js';
import { createAzureOpenAIClient } from './client.js';
import { detectFoundryError } from './errors.js';
import { callShield, createAutoShieldMiddleware } from './safety.js';
import { callGround } from './grounding.js';
import { callSearch } from './search.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 30000;

// ============================================================
// MODULE-LEVEL HELPERS
// ============================================================

/**
 * Extract a text string from the last message in a messages array.
 * Used by the tool_loop per-iteration auto-shield to obtain the text
 * to evaluate regardless of whether the iteration carries a user prompt
 * or tool results.
 */
function extractLastMessageText(msgs: unknown[]): string {
  if (msgs.length === 0) {
    return '';
  }
  const last = msgs[msgs.length - 1];
  if (!last || typeof last !== 'object') {
    return '';
  }
  const msg = last as Record<string, unknown>;
  const content = msg['content'];
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Some message formats use content as an array of part objects
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>)['text'] === 'string') {
          return (part as Record<string, unknown>)['text'] as string;
        }
        return '';
      })
      .join('');
  }
  return '';
}

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
 * @throws RuntimeError for invalid endpoint or auth (EC-1, EC-2)
 */
export async function createFoundryExtension(
  config: FoundryConfig
): Promise<ExtensionFactoryResult> {
  // EC-1: Validate endpoint is non-empty
  if (!config.endpoint || config.endpoint.trim().length === 0) {
    throw new RuntimeError('RILL-R005', 'foundry: endpoint is required');
  }

  // EC-2: Validate auth is present
  if (!config.auth) {
    throw new RuntimeError('RILL-R005', 'foundry: auth is required');
  }

  // EC-3: Validate auth.type
  if (config.auth.type !== 'api-key' && config.auth.type !== 'entra') {
    throw new RuntimeError('RILL-R005', "foundry: auth.type must be 'api-key' or 'entra'");
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

  // Object-reference disposal flag shared with safety/grounding/search modules
  const disposedRef: { value: boolean } = { value: false };

  // ============================================================
  // AUTO-SHIELD MIDDLEWARE
  // ============================================================

  // Create once; used to wrap message, messages, generate, and tool_loop callbacks.
  const autoShieldMiddleware =
    config.contentSafety?.autoShield === true
      ? createAutoShieldMiddleware(config, config.auth, disposedRef)
      : null;

  // ============================================================
  // USAGE ACCUMULATOR (IR-7)
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
   * Guard: throws EC-4/EC-5/EC-6 when inference config is absent or incomplete.
   * Called at the top of every LLM host function.
   */
  function assertInference(): { model: string; apiVersion: string } {
    if (!inference) {
      throw new RuntimeError('RILL-R005', 'foundry: inference not configured');
    }
    // EC-5: model is required
    if (!inference.model || inference.model.trim().length === 0) {
      throw new RuntimeError('RILL-R005', 'foundry: model is required');
    }
    // EC-6: apiVersion is required
    if (!inference.apiVersion || inference.apiVersion.trim().length === 0) {
      throw new RuntimeError('RILL-R005', 'foundry: inference.apiVersion is required');
    }
    return { model: inference.model, apiVersion: inference.apiVersion };
  }

  // ============================================================
  // DISPOSAL GUARD
  // ============================================================

  function assertNotDisposed(): void {
    if (!abortController) {
      throw new RuntimeError('RILL-R005', 'foundry: extension disposed');
    }
  }

  // ============================================================
  // DISPOSE (IR-8)
  // ============================================================

  const dispose = async (): Promise<void> => {
    // Idempotent: second call is no-op
    if (!abortController) {
      return;
    }

    try {
      abortController.abort();
    } catch {
      // ignore abort errors
    }

    abortController = undefined;
    disposedRef.value = true;
  };

  // ============================================================
  // LLM HOST FUNCTIONS
  // ============================================================

  const fnDict: {
    message: RillFunction;
    messages: RillFunction;
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
        p.str('text'),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed();
        assertInference();

        const text = args['text'] as string;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        if (text.trim().length === 0) {
          throw new RuntimeError('RILL-R005', 'prompt text cannot be empty');
        }

        const system =
          typeof options['system'] === 'string' ? options['system'] : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];
        if (system !== undefined) {
          apiMessages.push({ role: 'system', content: system });
        }
        apiMessages.push({ role: 'user', content: text });

        const runner = client.chat.completions.stream({
          model: factoryModel!,
          max_completion_tokens: maxTokens,
          messages: apiMessages,
          stream_options: { include_usage: true },
          ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
        });

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            throwProviderHalt(ctx as RuntimeContext, 'Foundry', error, detectFoundryError);
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
              messages: buildResponseMessages(
                [
                  ...(system ? [{ role: 'system', content: system }] : []),
                  { role: 'user', content: text },
                ],
                content
              ),
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

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

              ? error

              : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:message:error',
              subsystem: 'extension:foundry',
              model: factoryModel ?? '',
              error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
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
            usage: { type: { kind: 'dict' as const, fields: { input: { type: { kind: 'number' as const } }, output: { type: { kind: 'number' as const } } } } },
            stop_reason: { type: { kind: 'string' as const } },
            id: { type: { kind: 'string' as const } },
            messages: { type: { kind: 'list' as const, element: { kind: 'dict' as const } } },
          },
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => { runner.abort(); },
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
            usage: { type: { kind: 'dict', fields: { input: { type: { kind: 'number' } }, output: { type: { kind: 'number' } } } } },
            stop_reason: { type: { kind: 'string' } },
            id: { type: { kind: 'string' } },
            messages: { type: { kind: 'list', element: { kind: 'dict' } } },
          },
        },
      }),
    },

    // -------------------------------------------------------
    // messages
    // -------------------------------------------------------
    messages: {
      params: [
        p.list('messages', { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } }),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed();
        assertInference();

        const messages = args['messages'] as Array<Record<string, unknown>>;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        if (messages.length === 0) {
          throw new RuntimeError('RILL-R005', 'messages list cannot be empty');
        }

        const system =
          typeof options['system'] === 'string' ? options['system'] : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];
        if (system !== undefined) {
          apiMessages.push({ role: 'system', content: system });
        }

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];

          if (!msg || typeof msg !== 'object' || !('role' in msg)) {
            throw new RuntimeError('RILL-R005', "message missing required 'role' field");
          }

          const role = msg['role'];

          if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
            throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
          }

          if (role === 'user' || role === 'tool') {
            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError('RILL-R005', `${role} message requires 'content'`);
            }
            apiMessages.push({ role: role as 'user', content: msg['content'] as string });
          } else if (role === 'assistant') {
            const hasContent = 'content' in msg && msg['content'];
            const hasToolCalls = 'tool_calls' in msg && msg['tool_calls'];

            if (!hasContent && !hasToolCalls) {
              throw new RuntimeError('RILL-R005', "assistant message requires 'content' or 'tool_calls'");
            }

            if (hasContent) {
              apiMessages.push({ role: 'assistant', content: msg['content'] as string });
            }
          }
        }

        const runner = client.chat.completions.stream({
          model: factoryModel!,
          max_completion_tokens: maxTokens,
          messages: apiMessages,
          stream_options: { include_usage: true },
          ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
        });

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            throwProviderHalt(ctx as RuntimeContext, 'Foundry', error, detectFoundryError);
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
              messages: buildResponseMessages(
                messages.map((m) => ({
                  role: m['role'] as string,
                  content: (m['content'] as string) ?? '',
                })),
                content
              ),
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

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

              ? error

              : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:message:error',
              subsystem: 'extension:foundry',
              model: factoryModel ?? '',
              error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
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
            usage: { type: { kind: 'dict' as const, fields: { input: { type: { kind: 'number' as const } }, output: { type: { kind: 'number' as const } } } } },
            stop_reason: { type: { kind: 'string' as const } },
            id: { type: { kind: 'string' as const } },
            messages: { type: { kind: 'list' as const, element: { kind: 'dict' as const } } },
          },
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => { runner.abort(); },
          chunkType: { kind: 'string' },
          retType,
        });
      },
      annotations: { description: 'Send multi-turn conversation to Azure AI Foundry' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: {
          kind: 'dict',
          fields: {
            content: { type: { kind: 'string' } },
            model: { type: { kind: 'string' } },
            usage: { type: { kind: 'dict', fields: { input: { type: { kind: 'number' } }, output: { type: { kind: 'number' } } } } },
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

        assertNotDisposed();
        assertInference();

        try {
          const text = args['text'] as string;

          validateEmbedText(text.trim());
          validateEmbedModel(factoryEmbedModel);

          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: text,
            encoding_format: 'float',
          });

          const embeddingData = response.data[0]?.embedding;
          if (!embeddingData || embeddingData.length === 0) {
            throw new RuntimeError('RILL-R005', 'foundry: empty embedding returned');
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
          const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

            ? error

            : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
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

        assertNotDisposed();
        assertInference();

        try {
          const texts = args['texts'] as Array<RillValue>;

          if (texts.length === 0) {
            return [] as RillValue;
          }

          validateEmbedModel(factoryEmbedModel);

          const stringTexts = validateEmbedBatch(texts);

          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: stringTexts,
            encoding_format: 'float',
          });

          const vectors: RillValue[] = [];
          for (const embeddingItem of response.data) {
            const embeddingData = embeddingItem.embedding;
            if (!embeddingData || embeddingData.length === 0) {
              throw new RuntimeError('RILL-R005', 'foundry: empty embedding returned');
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
          const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

            ? error

            : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:embed',
            subsystem: 'extension:foundry',
            error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
            duration,
          });
          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vectors for multiple texts' },
      returnType: structureToTypeValue({ kind: 'list', element: { kind: 'vector' } }),
    },

    // -------------------------------------------------------
    // tool_loop
    // -------------------------------------------------------
    tool_loop: {
      params: [
        p.str('prompt'),
        {
          name: 'tools',
          type: { kind: 'dict', valueType: { kind: 'closure' } },
          defaultValue: undefined,
          annotations: {},
        },
        p.dict('options', undefined, undefined, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
          max_errors: { type: { kind: 'number' }, defaultValue: 3 },
          max_turns: { type: { kind: 'number' }, defaultValue: 10 },
          messages: { type: { kind: 'list', element: { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } } }, defaultValue: [] },
        }),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed();
        assertInference();

        const prompt = args['prompt'] as string;
        const toolsDict = args['tools'] as RillValue;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        if (prompt.trim().length === 0) {
          throw new RuntimeError('RILL-R005', 'prompt text cannot be empty');
        }

        const system =
          typeof options['system'] === 'string' ? options['system'] : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;
        const maxErrors =
          typeof options['max_errors'] === 'number' ? options['max_errors'] : 3;
        const maxTurns =
          typeof options['max_turns'] === 'number' ? options['max_turns'] : 10;

        const messages: OpenAI.ChatCompletionMessageParam[] = [];

        if (system !== undefined) {
          messages.push({ role: 'system', content: system });
        }

        if ('messages' in options && Array.isArray(options['messages'])) {
          const prependedMessages = options['messages'] as Array<Record<string, unknown>>;

          for (const msg of prependedMessages) {
            if (!msg || typeof msg !== 'object' || !('role' in msg)) {
              throw new RuntimeError('RILL-R005', "message missing required 'role' field");
            }

            const role = msg['role'];
            if (role !== 'user' && role !== 'assistant') {
              throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
            }

            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError('RILL-R005', `${role} message requires 'content'`);
            }

            messages.push({
              role: role as 'user' | 'assistant',
              content: msg['content'] as string,
            });
          }
        }

        messages.push({ role: 'user', content: prompt });

        const callbacks: ToolLoopCallbacks = {
          buildTools: (
            toolDefs: Array<{ name: string; description: string; input_schema: object }>
          ): OpenAI.ChatCompletionTool[] => {
            return toolDefs.map((def) => ({
              type: 'function' as const,
              function: {
                name: def.name,
                description: def.description,
                parameters: def.input_schema as Record<string, unknown>,
              },
            }));
          },

          callAPI: async (
            msgs: unknown[],
            tools: unknown,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
              model: factoryModel!,
              max_completion_tokens: maxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }

            const response = await client.chat.completions.create(apiParams, { signal });

            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          callAPIStreaming: async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const streamRunner = client.chat.completions.stream({
              model: factoryModel!,
              max_completion_tokens: maxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
              stream_options: { include_usage: true },
              ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
            }, { signal });

            streamRunner.on('content', (delta: string) => {
              onTextDelta(delta);
            });

            const response = await streamRunner.finalChatCompletion();

            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          extractToolCalls: (
            response: unknown
          ): Array<{ id: string; name: string; input: object }> | null => {
            if (!response || typeof response !== 'object' || !('choices' in response)) {
              return null;
            }

            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) {
              return null;
            }

            const choice = choices[0];
            if (!choice || typeof choice !== 'object' || !('message' in choice)) {
              return null;
            }

            const message = (choice as { message: unknown }).message;
            if (!message || typeof message !== 'object' || !('tool_calls' in message)) {
              return null;
            }

            const toolCalls = (message as { tool_calls: unknown[] | null }).tool_calls;
            if (!toolCalls || !Array.isArray(toolCalls)) {
              return null;
            }

            const functionToolCalls = toolCalls.filter(
              (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall =>
                typeof tc === 'object' &&
                tc !== null &&
                'type' in tc &&
                (tc as { type: unknown }).type === 'function'
            );

            return functionToolCalls.map((tc) => {
              const functionCall = tc as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                function: { name: string; arguments: string };
              };
              const tcArgs = functionCall.function.arguments;
              let parsedArgs: object;
              try {
                parsedArgs = JSON.parse(tcArgs);
              } catch {
                parsedArgs = {};
              }
              return {
                id: tc.id,
                name: functionCall.function.name,
                input: parsedArgs,
              };
            });
          },

          formatAssistantMessage: (response: unknown): unknown => {
            if (!response || typeof response !== 'object' || !('choices' in response)) {
              return null;
            }

            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) {
              return null;
            }

            const choice = choices[0];
            if (!choice || typeof choice !== 'object' || !('message' in choice)) {
              return null;
            }

            const msg = (choice as { message: unknown }).message;
            if (!msg || typeof msg !== 'object') {
              return null;
            }

            const m = msg as Record<string, unknown>;
            const clean: Record<string, unknown> = {
              role: m['role'],
              content: m['content'],
            };
            if (m['tool_calls']) {
              clean['tool_calls'] = m['tool_calls'];
            }
            return clean;
          },

          formatToolResult: (
            toolResults: Array<{ id: string; name: string; result: RillValue; error?: string }>
          ): unknown => {
            return toolResults.map((tr) => ({
              role: 'tool' as const,
              tool_call_id: tr.id,
              content: tr.error
                ? JSON.stringify({ error: tr.error, code: 'RILL-R001' })
                : typeof tr.result === 'string'
                  ? tr.result
                  : JSON.stringify(tr.result),
            }));
          },
        };

        // -------------------------------------------------------
        // Per-iteration auto-shield for tool_loop
        // Wraps callAPI and callAPIStreaming so the shield check
        // runs before every LLM API call, including iterations
        // carrying tool results.
        // -------------------------------------------------------
        if (autoShieldMiddleware) {
          const shield = autoShieldMiddleware;
          const origCallAPI = callbacks.callAPI;
          const origCallAPIStreaming = callbacks.callAPIStreaming;

          callbacks.callAPI = async (
            msgs: unknown[],
            tools: unknown,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const promptText = extractLastMessageText(msgs);
            const shieldArgs: Record<string, RillValue> = { text: promptText as RillValue };
            await shield(
              shieldArgs,
              ctx as RuntimeContext,
              async () => null as unknown as RillValue,
              'tool_loop'
            );
            return origCallAPI(msgs, tools, signal);
          };

          if (origCallAPIStreaming) {
            callbacks.callAPIStreaming = async (
              msgs: unknown[],
              tools: unknown,
              onTextDelta: (text: string) => void,
              signal?: AbortSignal
            ): Promise<unknown> => {
              const promptText = extractLastMessageText(msgs);
              const shieldArgs: Record<string, RillValue> = { text: promptText as RillValue };
              await shield(
                shieldArgs,
                ctx as RuntimeContext,
                async () => null as unknown as RillValue,
                'tool_loop'
              );
              return origCallAPIStreaming(msgs, tools, onTextDelta, signal);
            };
          }
        }

        const chunkBuffer: RillValue[] = [];

        const yieldChunk = (chunk: RillValue): void => {
          chunkBuffer.push(chunk);
        };

        const toolLoopAbortController = new AbortController();

        const loopPromise = executeToolLoop(
          messages,
          toolsDict,
          maxErrors,
          callbacks,
          (event: string, data: Record<string, unknown>) => {
            const eventMap: Record<string, string> = {
              tool_call: 'foundry:tool_call',
              tool_result: 'foundry:tool_result',
            };

            emitExtensionEvent(ctx as RuntimeContext, {
              event: eventMap[event] ?? event,
              subsystem: 'extension:foundry',
              ...data,
            });
          },
          maxTurns,
          ctx,
          yieldChunk,
          toolLoopAbortController.signal
        );

        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            await loopPromise;
            for (const chunk of chunkBuffer) {
              yield chunk;
            }
          } catch (error: unknown) {
            throwProviderHalt(ctx as RuntimeContext, 'Foundry', error, detectFoundryError);
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await loopPromise;

            const response =
              loopResult.response as OpenAI.Chat.Completions.ChatCompletion | null;
            const content = response?.choices[0]?.message?.content ?? '';
            const stopReason =
              loopResult.turns >= maxTurns
                ? 'max_turns'
                : (response?.choices[0]?.finish_reason ?? 'stop');

            const inputMessages = messages
              .filter((m) => 'role' in m && (m as unknown as Record<string, unknown>)['role'] !== 'system')
              .map((m) => {
                const msg = m as unknown as Record<string, unknown>;
                return {
                  role: msg['role'] as string,
                  content:
                    msg['content'] == null
                      ? ''
                      : typeof msg['content'] === 'string'
                        ? msg['content']
                        : JSON.stringify(msg['content']),
                };
              });

            accumulateUsage(loopResult.totalTokens.input, loopResult.totalTokens.output);

            const result = {
              content,
              model: factoryModel ?? '',
              usage: {
                input: loopResult.totalTokens.input,
                output: loopResult.totalTokens.output,
              },
              stop_reason: stopReason,
              turns: loopResult.turns,
              messages: response
                ? buildResponseMessages(inputMessages, content)
                : inputMessages,
            };

            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:tool_loop',
              subsystem: 'extension:foundry',
              model: factoryModel ?? '',
              iterations: loopResult.turns,
              totalTokens: loopResult.totalTokens.input + loopResult.totalTokens.output,
              duration,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

              ? error

              : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'foundry:error',
              subsystem: 'extension:foundry',
              error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
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
            usage: { type: { kind: 'dict' as const, fields: { input: { type: { kind: 'number' as const } }, output: { type: { kind: 'number' as const } } } } },
            stop_reason: { type: { kind: 'string' as const } },
            turns: { type: { kind: 'number' as const } },
            messages: { type: { kind: 'list' as const, element: { kind: 'dict' as const } } },
          },
        };

        return createRillStream({
          chunks: chunks(),
          resolve,
          dispose: () => { toolLoopAbortController.abort(); },
          chunkType: { kind: 'dict' },
          retType,
        });
      },
      annotations: { description: 'Execute tool-use loop with Azure AI Foundry' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'dict' },
        ret: {
          kind: 'dict',
          fields: {
            content: { type: { kind: 'string' } },
            model: { type: { kind: 'string' } },
            usage: { type: { kind: 'dict', fields: { input: { type: { kind: 'number' } }, output: { type: { kind: 'number' } } } } },
            stop_reason: { type: { kind: 'string' } },
            turns: { type: { kind: 'number' } },
            messages: { type: { kind: 'list', element: { kind: 'dict' } } },
          },
        },
      }),
    },

    // -------------------------------------------------------
    // generate
    // -------------------------------------------------------
    generate: {
      params: [
        p.str('prompt'),
        { name: 'schema', type: { kind: 'type' } as { kind: string }, defaultValue: undefined, annotations: { description: 'Type expression for structured output schema' } },
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
          messages: { type: { kind: 'list', element: { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } } }, defaultValue: [] },
        }),
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        assertNotDisposed();
        assertInference();

        try {
          const prompt = args['prompt'] as string;
          const schemaArg = args['schema'] as { __rill_type?: boolean; structure?: TypeStructure } | undefined;
          const options = (args['options'] ?? {}) as Record<string, unknown>;

          if (!schemaArg || !schemaArg.__rill_type || !schemaArg.structure) {
            throw new RuntimeError('RILL-R005', 'generate requires a type expression as schema');
          }
          if (schemaArg.structure.kind !== 'dict') {
            throw new RuntimeError(
              'RILL-R005',
              `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
            );
          }

          const jsonSchema = buildJsonSchemaFromStructuralType(schemaArg.structure);

          const system =
            typeof options['system'] === 'string' ? options['system'] : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
              ? options['max_tokens']
              : factoryMaxTokens;

          const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            apiMessages.push({ role: 'system', content: system });
          }

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<Record<string, unknown>>;

            for (const msg of prependedMessages) {
              if (!msg || typeof msg !== 'object' || !('role' in msg)) {
                throw new RuntimeError('RILL-R005', "message missing required 'role' field");
              }

              const role = msg['role'];
              if (role !== 'user' && role !== 'assistant') {
                throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
              }

              if (!('content' in msg) || typeof msg['content'] !== 'string') {
                throw new RuntimeError('RILL-R005', `${role} message requires 'content'`);
              }

              apiMessages.push({
                role: role as 'user' | 'assistant',
                content: msg['content'] as string,
              });
            }
          }

          apiMessages.push({ role: 'user', content: prompt });

          const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: factoryModel!,
            max_completion_tokens: maxTokens,
            messages: apiMessages,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'output',
                schema: jsonSchema as unknown as Record<string, unknown>,
                strict: true,
              },
            },
          };

          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }

          const response = await client.chat.completions.create(apiParams);

          const raw = response.choices[0]?.message?.content ?? '';

          let data: unknown;
          try {
            data = JSON.parse(raw) as unknown;
          } catch (parseError: unknown) {
            const detail =
              parseError instanceof Error ? parseError.message : String(parseError);
            throw new RuntimeError('RILL-R005', `generate: failed to parse response JSON: ${detail}`);
          }

          const inputTokens = response.usage?.prompt_tokens ?? 0;
          const outputTokens = response.usage?.completion_tokens ?? 0;
          accumulateUsage(inputTokens, outputTokens);

          const result = {
            data,
            raw,
            model: response.model,
            usage: { input: inputTokens, output: outputTokens },
            stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
            id: response.id,
          };

          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:generate',
            subsystem: 'extension:foundry',
            duration,
            model: response.model,
            inputTokens,
            outputTokens,
          });

          return result as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal = error instanceof RuntimeError

            ? error

            : new RuntimeHaltSignal(mapProviderError(ctx as RuntimeContext, 'Foundry', error, detectFoundryError), true);
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'foundry:error',
            subsystem: 'extension:foundry',
            error: (rillError instanceof RuntimeHaltSignal ? getStatus(rillError.value).message : rillError.message),
            duration,
          });
          throw rillError;
        }
      },
      annotations: { description: 'Generate structured output from Azure AI Foundry' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          data: { type: { kind: 'any' } },
          raw: { type: { kind: 'string' } },
          model: { type: { kind: 'string' } },
          usage: { type: { kind: 'dict', fields: { input: { type: { kind: 'number' } }, output: { type: { kind: 'number' } } } } },
          stop_reason: { type: { kind: 'string' } },
          id: { type: { kind: 'string' } },
        },
      }),
    },
  };

  // ============================================================
  // AUTO-SHIELD WRAPPING (message, messages, generate)
  // ============================================================

  // When autoShield is enabled, wrap the outer fn for message, messages, and generate
  // so the shield check runs before each LLM call.
  // embed and embed_batch are excluded per spec.
  // tool_loop per-iteration shielding is handled inside the callbacks (see tool_loop.fn).

  function wrapWithShield(rillFn: typeof fnDict.message, triggeredBy: string): typeof fnDict.message {
    if (!autoShieldMiddleware) {
      return rillFn;
    }
    const shield = autoShieldMiddleware;
    return {
      ...rillFn,
      fn: async (args, ctx): Promise<RillValue> => {
        return shield(
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
  const messagesFn = wrapWithShield(fnDict.messages, 'messages');
  const generateFn = wrapWithShield(fnDict.generate, 'generate');

  // Apply LlmExtensionContract satisfies check at compile time
  const callableDict = {
    message: toCallable(messageFn),
    messages: toCallable(messagesFn),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(generateFn),
  } satisfies LlmExtensionContract;

  // ============================================================
  // ADDITIONAL HOST FUNCTIONS (IR-7, tasks 1.4 and 1.5)
  // ============================================================

  const usageFn: RillFunction = {
    params: [],
    fn: (_args, _ctx): RillValue => {
      assertNotDisposed();
      return {
        input_tokens: usageInputTokens,
        output_tokens: usageOutputTokens,
      } as RillValue;
    },
    annotations: { description: 'Return accumulated token usage since factory creation' },
    returnType: structureToTypeValue({
      kind: 'dict',
      fields: {
        input_tokens: { type: { kind: 'number' } },
        output_tokens: { type: { kind: 'number' } },
      },
    }),
  };

  const shieldFn: RillFunction = {
    params: [
      p.str('text'),
      p.list('documents', undefined),
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      const text = args['text'] as string;
      const documents = (args['documents'] ?? []) as Array<RillValue>;
      const stringDocs = documents.filter((d): d is string => typeof d === 'string');
      return callShield(text, stringDocs, config, config.auth, ctx as RuntimeContext, disposedRef);
    },
    annotations: { description: 'Evaluate text for prompt attacks via Azure Content Safety' },
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
      return callGround(query, config, client, ctx as RuntimeContext, disposedRef);
    },
    annotations: { description: 'Ground a query via Bing using Azure AI Foundry' },
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
      p.dict('options', undefined, {}, {
        index: { type: { kind: 'string' }, defaultValue: '' },
        queryType: { type: { kind: 'string' }, defaultValue: '' },
        top: { type: { kind: 'number' }, defaultValue: 10 },
        filter: { type: { kind: 'string' }, defaultValue: '' },
      }),
    ],
    fn: async (args, ctx): Promise<RillValue> => {
      const query = args['query'] as string;
      const options = (args['options'] ?? {}) as Record<string, RillValue>;
      return callSearch(query, options, config, config.auth, ctx as RuntimeContext, disposedRef);
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
