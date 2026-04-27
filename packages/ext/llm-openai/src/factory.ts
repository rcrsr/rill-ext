/**
 * Extension factory for OpenAI API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import OpenAI from 'openai';
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
  validateApiKey,
  validateModel,
  validateTemperature,
  validateEmbedText,
  validateEmbedModel,
  validateEmbedBatch,
  mapProviderError,
  throwProviderHalt,
  executeToolLoop,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

// ============================================================
// ERROR DETECTION
// ============================================================

/**
 * OpenAI-specific error detector for mapProviderError.
 * Extracts status code and message from OpenAI.APIError instances.
 *
 * @param error - Error to detect
 * @returns Status and message if OpenAI error, null otherwise
 */
const detectOpenAIError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof OpenAI.APIError) {
    return {
      status: error.status ?? undefined,
      message: error.message,
    };
  }
  return null;
};

// ============================================================
// FACTORY
// ============================================================

/**
 * Create OpenAI extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createOpenAIExtension({
 *   api_key: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4-turbo',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createOpenAIExtension(
  config: OpenAIExtensionConfig
): ExtensionFactoryResult {
  // Validate required fields (§4.1)
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  // Note: will be used in tasks 3.3 and 3.4 for actual function implementations
  const client = new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    maxRetries: config.max_retries,
    timeout: config.timeout,
  });

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;

  // Suppress unused variable warnings for values used in task 3.4
  void factoryEmbedModel;

  // AbortController for cancelling pending requests (§4.9, IR-11)
  let abortController: AbortController | undefined = new AbortController();

  // Dispose function for cleanup (§4.9)
  const dispose = async (): Promise<void> => {
    // AC-28: Idempotent cleanup, try-catch each step
    try {
      // Cancel pending API requests via AbortController (IR-11)
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to abort OpenAI requests: ${message}`);
    }

    try {
      // Cleanup SDK HTTP connections
      // Note: OpenAI SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup OpenAI SDK: ${message}`);
    }
  };

  // Return extension result with implementations — satisfies verifies contract at compile time (IR-8)
  const fnDict: { message: RillFunction; messages: RillFunction; embed: RillFunction; embed_batch: RillFunction; tool_loop: RillFunction; generate: RillFunction } = ({
    // IR-4: openai::message
    message: {
      params: [
        p.str('text'),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: (args, ctx): RillValue => {
        // Extract arguments
        const text = args['text'] as string;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // EC-1: Validate text is non-empty before stream creation
        if (text.trim().length === 0) {
          throw new RuntimeError('RILL-R005', 'prompt text cannot be empty');
        }

        // Extract options
        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        // Build messages array (OpenAI uses system as first message, not separate param)
        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

        if (system !== undefined) {
          apiMessages.push({
            role: 'system',
            content: system,
          });
        }

        apiMessages.push({
          role: 'user',
          content: text,
        });

        // Start the stream — runner is an AsyncIterable<ChatCompletionChunk>
        const runner = client.chat.completions.stream({
          model: factoryModel,
          max_completion_tokens: maxTokens,
          messages: apiMessages,
          stream_options: { include_usage: true },
          ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
        });

        // Async generator yields string text deltas from provider
        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            // EC-2/EC-3: Map provider errors during streaming
            throwProviderHalt(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
          }
        }

        // Resolve callback builds the same dict shape as the pre-streaming return
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalChatCompletion();
            const content = response.choices[0]?.message?.content ?? '';

            const result = {
              content,
              model: response.model,
              usage: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
              },
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

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:message',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
              request: apiMessages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            // EC-12: Provider failure during resolution — emit error event
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
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
      annotations: { description: 'Send single message to OpenAI API' },
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

    // IR-5: openai::messages
    messages: {
      params: [
        p.list('messages', { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } }),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: (args, ctx): RillValue => {
        // Extract arguments
        const messages = args['messages'] as Array<Record<string, unknown>>;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // AC-23: Empty messages list raises error before stream creation
        if (messages.length === 0) {
          throw new RuntimeError(
            'RILL-R005',
            'messages list cannot be empty'
          );
        }

        // Extract options
        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;

        // Build messages array (OpenAI uses system as first message)
        const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

        if (system !== undefined) {
          apiMessages.push({
            role: 'system',
            content: system,
          });
        }

        // Validate and transform messages
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];

          // EC-10: Missing role raises error
          if (!msg || typeof msg !== 'object' || !('role' in msg)) {
            throw new RuntimeError(
              'RILL-R005',
              "message missing required 'role' field"
            );
          }

          const role = msg['role'];

          // EC-11: Unknown role value raises error
          if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
            throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
          }

          // EC-12: User message missing content
          if (role === 'user' || role === 'tool') {
            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError(
                'RILL-R005',
                `${role} message requires 'content'`
              );
            }
            apiMessages.push({
              role: role as 'user',
              content: msg['content'] as string,
            });
          }
          // EC-13: Assistant missing both content and tool_calls
          else if (role === 'assistant') {
            const hasContent = 'content' in msg && msg['content'];
            const hasToolCalls = 'tool_calls' in msg && msg['tool_calls'];

            if (!hasContent && !hasToolCalls) {
              throw new RuntimeError(
                'RILL-R005',
                "assistant message requires 'content' or 'tool_calls'"
              );
            }

            // For now, we only support content
            if (hasContent) {
              apiMessages.push({
                role: 'assistant',
                content: msg['content'] as string,
              });
            }
          }
        }

        // Start the stream — runner is an AsyncIterable<ChatCompletionChunk>
        const runner = client.chat.completions.stream({
          model: factoryModel,
          max_completion_tokens: maxTokens,
          messages: apiMessages,
          stream_options: { include_usage: true },
          ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
        });

        // Async generator yields string text deltas from provider
        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const chunk of runner) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            // EC-2/EC-3: Map provider errors during streaming
            throwProviderHalt(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
          }
        }

        // Resolve callback builds the same dict shape as the pre-streaming return
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await runner.finalChatCompletion();
            const content = response.choices[0]?.message?.content ?? '';

            const result = {
              content,
              model: response.model,
              usage: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
              },
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

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:messages',
              subsystem: 'extension:openai',
              duration,
              model: response.model,
              usage: result.usage,
              request: apiMessages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            // EC-12: Provider failure during resolution — emit error event
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
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
      annotations: { description: 'Send multi-turn conversation to OpenAI API' },
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

    // IR-6: openai::embed
    embed: {
      params: [p.str('text')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const text = args['text'] as string;

          // EC-15: Validate text is non-empty
          validateEmbedText(text.trim());

          // EC-16: Validate embed_model is configured
          validateEmbedModel(factoryEmbedModel);

          // Call OpenAI embeddings API
          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: text,
            encoding_format: 'float',
          });

          // Extract embedding data
          const embeddingData = response.data[0]?.embedding;
          if (!embeddingData || embeddingData.length === 0) {
            throw new RuntimeError(
              'RILL-R005',
              'OpenAI: empty embedding returned'
            );
          }

          // Convert to Float32Array and create RillVector
          const float32Data = new Float32Array(embeddingData);
          const vector = createVector(float32Data, factoryEmbedModel);

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:embed',
            subsystem: 'extension:openai',
            duration,
            model: factoryEmbedModel,
            dimensions: float32Data.length,
          });

          return vector as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const invalid = mapProviderError(
            ctx as RuntimeContext,
            'OpenAI',
            error,
            detectOpenAIError
          );

          emitExtensionEvent(ctx as RuntimeContext, {
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
    },

    // IR-7: openai::embed_batch
    embed_batch: {
      params: [p.list('texts')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const texts = args['texts'] as Array<RillValue>;

          // AC-24: Empty list returns empty list
          if (texts.length === 0) {
            return [] as RillValue;
          }

          // EC-17: Validate embed_model is configured
          validateEmbedModel(factoryEmbedModel);

          // EC-18: Validate all elements are strings
          const stringTexts = validateEmbedBatch(texts);

          // Call OpenAI embeddings API with batch
          const response = await client.embeddings.create({
            model: factoryEmbedModel,
            input: stringTexts,
            encoding_format: 'float',
          });

          // Convert embeddings to RillVector list
          const vectors: RillValue[] = [];
          for (const embeddingItem of response.data) {
            const embeddingData = embeddingItem.embedding;
            if (!embeddingData || embeddingData.length === 0) {
              throw new RuntimeError(
                'RILL-R005',
                'OpenAI: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embeddingData);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

          // Emit success event (§4.10)
          const duration = Date.now() - startTime;
          const firstVector = vectors[0];
          const dimensions =
            firstVector && isVector(firstVector) ? firstVector.data.length : 0;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:embed_batch',
            subsystem: 'extension:openai',
            duration,
            model: factoryEmbedModel,
            dimensions,
            count: vectors.length,
          });

          return vectors as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const invalid = mapProviderError(
            ctx as RuntimeContext,
            'OpenAI',
            error,
            detectOpenAIError
          );

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(invalid).message,
            duration,
          });

          throw new RuntimeHaltSignal(invalid, true);
        }
      },
      annotations: { description: 'Generate embedding vectors for multiple texts' },
      returnType: structureToTypeValue({ kind: 'list', element: { kind: 'vector' } }),
    },

    // IR-8: openai::tool_loop
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
        // Extract arguments
        const prompt = args['prompt'] as string;
        const toolsDict = args['tools'] as RillValue;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // EC-20: Validate prompt is non-empty before stream creation
        if (prompt.trim().length === 0) {
          throw new RuntimeError('RILL-R005', 'prompt text cannot be empty');
        }

        // Extract options
        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;
        const maxErrors =
          typeof options['max_errors'] === 'number'
            ? options['max_errors']
            : 3;
        const maxTurns =
          typeof options['max_turns'] === 'number'
            ? options['max_turns']
            : 10;

        // Initialize conversation with prepended messages if provided
        const messages: OpenAI.ChatCompletionMessageParam[] = [];

        if (system !== undefined) {
          messages.push({
            role: 'system',
            content: system,
          });
        }

        if ('messages' in options && Array.isArray(options['messages'])) {
          const prependedMessages = options['messages'] as Array<
            Record<string, unknown>
          >;

          for (const msg of prependedMessages) {
            if (!msg || typeof msg !== 'object' || !('role' in msg)) {
              throw new RuntimeError(
                'RILL-R005',
                "message missing required 'role' field"
              );
            }

            const role = msg['role'];
            if (role !== 'user' && role !== 'assistant') {
              throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
            }

            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError(
                'RILL-R005',
                `${role} message requires 'content'`
              );
            }

            messages.push({
              role: role as 'user' | 'assistant',
              content: msg['content'] as string,
            });
          }
        }

        // Add the prompt as initial user message
        messages.push({
          role: 'user',
          content: prompt,
        });

        // Define OpenAI-specific callbacks for shared tool loop
        const callbacks: ToolLoopCallbacks = {
          // Build OpenAI Tool format from tool definitions
          buildTools: (
            toolDefs: Array<{
              name: string;
              description: string;
              input_schema: object;
            }>
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

          // Call OpenAI API (non-streaming fallback)
          callAPI: async (
            msgs: unknown[],
            tools: unknown,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
              model: factoryModel,
              max_completion_tokens: maxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }

            const response = await client.chat.completions.create(apiParams, { signal });

            // Normalize response to include usage in expected format
            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          // Call OpenAI API with streaming — IR-3: callAPIStreaming
          callAPIStreaming: async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const streamRunner = client.chat.completions.stream({
              model: factoryModel,
              max_completion_tokens: maxTokens,
              messages: msgs as OpenAI.ChatCompletionMessageParam[],
              tools: tools as OpenAI.ChatCompletionTool[],
              tool_choice: 'auto' as const,
              stream_options: { include_usage: true },
              ...(factoryTemperature !== undefined ? { temperature: factoryTemperature } : {}),
            }, { signal });

            // Emit text deltas as they arrive
            streamRunner.on('content', (delta: string) => {
              onTextDelta(delta);
            });

            // Await the final completion for tool extraction and token tracking
            const response = await streamRunner.finalChatCompletion();

            // Normalize response to include usage in expected format
            return {
              ...response,
              usage: {
                input_tokens: response.usage?.prompt_tokens ?? 0,
                output_tokens: response.usage?.completion_tokens ?? 0,
              },
            };
          },

          // Extract tool calls from OpenAI response
          extractToolCalls: (
            response: unknown
          ): Array<{ id: string; name: string; input: object }> | null => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('choices' in response)
            ) {
              return null;
            }

            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) {
              return null;
            }

            const choice = choices[0];
            if (
              !choice ||
              typeof choice !== 'object' ||
              !('message' in choice)
            ) {
              return null;
            }

            const message = (choice as { message: unknown }).message;
            if (
              !message ||
              typeof message !== 'object' ||
              !('tool_calls' in message)
            ) {
              return null;
            }

            const toolCalls = (message as { tool_calls: unknown[] | null })
              .tool_calls;
            if (!toolCalls || !Array.isArray(toolCalls)) {
              return null;
            }

            // Filter for function tool calls and extract relevant data
            const functionToolCalls = toolCalls.filter(
              (
                tc
              ): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall =>
                typeof tc === 'object' &&
                tc !== null &&
                'type' in tc &&
                tc.type === 'function'
            );

            return functionToolCalls.map((tc) => {
              // Type assertion safe because we filtered for function type
              const functionCall =
                tc as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                  function: { name: string; arguments: string };
                };
              const args = functionCall.function.arguments;
              let parsedArgs: object;
              try {
                parsedArgs = JSON.parse(args);
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

          // Extract assistant message (with tool_calls) from OpenAI response
          formatAssistantMessage: (response: unknown): unknown => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('choices' in response)
            ) {
              return null;
            }

            const choices = (response as { choices: unknown[] }).choices;
            if (!Array.isArray(choices) || choices.length === 0) {
              return null;
            }

            const choice = choices[0];
            if (
              !choice ||
              typeof choice !== 'object' ||
              !('message' in choice)
            ) {
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

          // Format tool results into OpenAI message format
          formatToolResult: (
            toolResults: Array<{
              id: string;
              name: string;
              result: RillValue;
              error?: string;
            }>
          ): unknown => {
            // For OpenAI, we need to add assistant message with tool calls,
            // then tool messages with results
            // Since executeToolLoop already extracted the tool calls, we only
            // return the tool result messages here
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

        // Chunk buffer — yieldChunk pushes here; generator yields from here
        const chunkBuffer: RillValue[] = [];

        const yieldChunk = (chunk: RillValue): void => {
          chunkBuffer.push(chunk);
        };

        const toolLoopAbortController = new AbortController();

        // Start the tool loop as a promise shared by both the generator and resolve
        const loopPromise = executeToolLoop(
          messages,
          toolsDict,
          maxErrors,
          callbacks,
          (event: string, data: Record<string, unknown>) => {
            // Map shared events to OpenAI-specific events
            const eventMap: Record<string, string> = {
              tool_call: 'openai:tool_call',
              tool_result: 'openai:tool_result',
            };

            emitExtensionEvent(ctx as RuntimeContext, {
              event: eventMap[event] || event,
              subsystem: 'extension:openai',
              ...data,
            });
          },
          maxTurns,
          ctx,
          yieldChunk,
          toolLoopAbortController.signal
        );

        // Async generator — awaits the tool loop then yields buffered chunks
        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            await loopPromise;
            for (const chunk of chunkBuffer) {
              yield chunk;
            }
          } catch (error: unknown) {
            if (error instanceof RuntimeHaltSignal) throw error;
            throwProviderHalt(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
          }
        }

        // Resolve callback — builds the same dict shape as pre-streaming return
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await loopPromise;

            // Extract response data
            const response =
              loopResult.response as OpenAI.Chat.Completions.ChatCompletion | null;
            const content = response?.choices[0]?.message?.content ?? '';
            const stopReason =
              loopResult.turns >= maxTurns
                ? 'max_turns'
                : (response?.choices[0]?.finish_reason ?? 'stop');

            // Build result dict
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

            const result = {
              content,
              model: factoryModel,
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

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:tool_loop',
              subsystem: 'extension:openai',
              turns: loopResult.turns,
              total_duration: duration,
              usage: result.usage,
              request: messages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            // EC-12: Provider failure during resolution — emit error event
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'openai:error',
                subsystem: 'extension:openai',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
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
      annotations: { description: 'Execute tool-use loop with OpenAI API' },
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

    // IR-3: openai::generate
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

        try {
          // Extract arguments
          const prompt = args['prompt'] as string;
          const schemaArg = args['schema'] as { __rill_type?: boolean; structure?: TypeStructure } | undefined;
          const options = (args['options'] ?? {}) as Record<string, unknown>;

          // EC-3: Validate schema is a type value with dict structure
          if (!schemaArg || !schemaArg.__rill_type || !schemaArg.structure) {
            throw new RuntimeError(
              'RILL-R005',
              'generate requires a type expression as schema'
            );
          }
          if (schemaArg.structure.kind !== 'dict') {
            throw new RuntimeError(
              'RILL-R005',
              `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
            );
          }

          // EC-4: Build JSON Schema from TypeStructure
          const jsonSchema = buildJsonSchemaFromStructuralType(schemaArg.structure);

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
              ? options['max_tokens']
              : factoryMaxTokens;

          // Build messages array: prepend conversation context if provided (AC-11)
          const apiMessages: OpenAI.ChatCompletionMessageParam[] = [];

          if (system !== undefined) {
            apiMessages.push({
              role: 'system',
              content: system,
            });
          }

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<
              Record<string, unknown>
            >;

            for (const msg of prependedMessages) {
              if (!msg || typeof msg !== 'object' || !('role' in msg)) {
                throw new RuntimeError(
                  'RILL-R005',
                  "message missing required 'role' field"
                );
              }

              const role = msg['role'];
              if (role !== 'user' && role !== 'assistant') {
                throw new RuntimeError('RILL-R005', `invalid role '${role}'`);
              }

              if (!('content' in msg) || typeof msg['content'] !== 'string') {
                throw new RuntimeError(
                  'RILL-R005',
                  `${role} message requires 'content'`
                );
              }

              apiMessages.push({
                role: role as 'user' | 'assistant',
                content: msg['content'] as string,
              });
            }
          }

          // Add the prompt as the final user message
          apiMessages.push({ role: 'user', content: prompt });

          // Call OpenAI API with native structured output via json_schema response_format
          const apiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
            model: factoryModel,
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

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }

          const response = await client.chat.completions.create(apiParams);

          // Extract JSON string from response (IR-5)
          const raw = response.choices[0]?.message?.content ?? '';

          // EC-5: Parse JSON, throw on failure with original error detail
          let data: unknown;
          try {
            data = JSON.parse(raw) as unknown;
          } catch (parseError: unknown) {
            const detail =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            throw new RuntimeError(
              'RILL-R005',
              `generate: failed to parse response JSON: ${detail}`
            );
          }

          // Build 6-key response dict (AC-6, AC-7, AC-8)
          const result = {
            data,
            raw,
            model: response.model,
            usage: {
              input: response.usage?.prompt_tokens ?? 0,
              output: response.usage?.completion_tokens ?? 0,
            },
            stop_reason: response.choices[0]?.finish_reason ?? 'unknown',
            id: response.id,
          };

          // Emit success event (AC-33)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:generate',
            subsystem: 'extension:openai',
            duration,
            model: response.model,
            usage: result.usage,
            request: apiMessages,
            content: raw,
          });

          return result as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          if (error instanceof RuntimeError) {
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: error.message,
              duration,
            });
            throw error;
          }
          if (error instanceof RuntimeHaltSignal) {
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'openai:error',
              subsystem: 'extension:openai',
              error: getStatus(error.value).message,
              duration,
            });
            throw error;
          }
          const invalid = mapProviderError(ctx as RuntimeContext, 'OpenAI', error, detectOpenAIError);
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'openai:error',
            subsystem: 'extension:openai',
            error: getStatus(invalid).message,
            duration,
          });
          throw new RuntimeHaltSignal(invalid, true);
        }
      },
      annotations: { description: 'Generate structured output from OpenAI API' },
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
  });

  const callableDict = {
    message: toCallable(fnDict.message),
    messages: toCallable(fnDict.messages),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(fnDict.generate),
  } satisfies LlmExtensionContract;

  return { value: callableDict as unknown as RillValue, dispose };
}
