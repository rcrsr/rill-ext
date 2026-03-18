/**
 * Extension factory for Anthropic Claude API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  RuntimeError,
  createRillStream,
  emitExtensionEvent,
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
  validateEmbedBatch,
  validateEmbedModel,
  mapProviderError,
  executeToolLoop,
  buildJsonSchema,
  buildResponseMessages,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extract text content from Anthropic API response content array.
 *
 * @param content - Content array from API response
 * @returns Concatenated text from all text blocks
 */
function extractTextContent(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('');
}

/**
 * Anthropic-specific error detector for mapProviderError.
 * Extracts status code and message from Anthropic.APIError instances.
 *
 * @param error - Unknown error value
 * @returns Object with status and message if Anthropic error, null otherwise
 */
const detectAnthropicError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof Anthropic.APIError) {
    return {
      status: error.status,
      message: error.message,
    };
  }
  return null;
};

/**
 * Wrap shared validation to convert RILL-R001 errors to RILL-R004.
 * Extension errors use RILL-R004 code for consistency with existing behavior.
 *
 * @param fn - Validation function to wrap
 * @returns Wrapped function that throws RILL-R004 errors
 */
function wrapValidation<T extends unknown[]>(
  fn: (...args: T) => void | string[]
): (...args: T) => void | string[] {
  return (...args: T) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof RuntimeError && error.errorId === 'RILL-R001') {
        throw new RuntimeError('RILL-R004', error.message);
      }
      throw error;
    }
  };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Anthropic extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createAnthropicExtension({
 *   api_key: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-sonnet-4-5-20250929',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createAnthropicExtension(
  config: AnthropicExtensionConfig
): ExtensionFactoryResult {
  // Validate required fields
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  const client = new Anthropic({
    apiKey: config.api_key,
    baseURL: config.base_url,
    maxRetries: config.max_retries,
    timeout: config.timeout,
  });

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;

  // Dispose function for cleanup (§4.9)
  const dispose = async (): Promise<void> => {
    // AC-28: Idempotent cleanup, try-catch each step
    try {
      // Cleanup SDK HTTP connections
      // Note: @anthropic-ai/sdk doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern and future SDK versions
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Anthropic SDK: ${message}`);
    }
  };

  // Return extension result with implementations — satisfies verifies contract at compile time (IR-8)
  const fnDict: { message: RillFunction; messages: RillFunction; embed: RillFunction; embed_batch: RillFunction; tool_loop: RillFunction; generate: RillFunction } = ({
    // IR-4: anthropic::message
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
          throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
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

        // Build API parameters
        const apiParams: Anthropic.MessageStreamParams = {
          model: factoryModel,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'user',
              content: text,
            },
          ],
        };

        // Add optional parameters only if defined
        if (factoryTemperature !== undefined) {
          apiParams.temperature = factoryTemperature;
        }
        if (system !== undefined) {
          apiParams.system = system;
        }

        // Create the Anthropic streaming request (lazy — SDK starts on first iteration)
        const sdkStream = client.messages.stream(apiParams);

        // Async generator yields string text deltas from the provider stream
        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const event of sdkStream) {
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
              ) {
                yield event.delta.text;
              }
            }
          } catch (error: unknown) {
            const rillError = mapProviderError(
              'Anthropic',
              error,
              detectAnthropicError
            );
            throw rillError;
          }
        }

        // Resolve callback — called after chunk exhaustion or directly
        // Returns the same dict shape as the pre-streaming return
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await sdkStream.finalMessage();

            const content = extractTextContent(
              response.content as Array<{ type: string; text?: string }>
            );

            const result = {
              content,
              model: response.model,
              usage: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
              },
              stop_reason: response.stop_reason,
              id: response.id,
              messages: buildResponseMessages(
                [{ role: 'user', content: text }],
                content
              ),
            };

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:message',
              subsystem: 'extension:anthropic',
              duration,
              model: response.model,
              usage: result.usage,
              request: apiParams.messages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError = mapProviderError(
              'Anthropic',
              error,
              detectAnthropicError
            );

            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: rillError.message,
              duration,
            });

            throw rillError;
          }
        };

        const retTypeStructure = {
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
          dispose: () => { sdkStream.abort(); },
          chunkType: { kind: 'string' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Send single message to Claude API' },
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

    // IR-5: anthropic::messages
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
        const msgList = args['messages'] as Array<Record<string, unknown>>;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // AC-23: Empty messages list raises error — before stream creation
        if (msgList.length === 0) {
          throw new RuntimeError(
            'RILL-R004',
            'messages list cannot be empty'
          );
        }

        // Transform and validate messages to Anthropic format
        const apiMessages: Anthropic.MessageParam[] = [];

        for (let i = 0; i < msgList.length; i++) {
          const msg = msgList[i]!;

          // EC-10: Missing role raises error
          if (!msg || typeof msg !== 'object' || !('role' in msg)) {
            throw new RuntimeError(
              'RILL-R004',
              "message missing required 'role' field"
            );
          }

          const role = msg['role'];

          // EC-11: Unknown role value raises error
          if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
            throw new RuntimeError('RILL-R004', `invalid role '${role}'`);
          }

          // EC-12: User message missing content
          if (role === 'user' || role === 'tool') {
            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError(
                'RILL-R004',
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
                'RILL-R004',
                "assistant message requires 'content' or 'tool_calls'"
              );
            }

            // For now, we only support content (tool_calls handled in task 2.6)
            if (hasContent) {
              apiMessages.push({
                role: 'assistant',
                content: msg['content'] as string,
              });
            }
          }
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

        // Build API parameters
        const apiParams: Anthropic.MessageStreamParams = {
          model: factoryModel,
          max_tokens: maxTokens,
          messages: apiMessages,
        };

        // Add optional parameters only if defined
        if (factoryTemperature !== undefined) {
          apiParams.temperature = factoryTemperature;
        }
        if (system !== undefined) {
          apiParams.system = system;
        }

        // Create the Anthropic streaming request (lazy — SDK starts on first iteration)
        const sdkStream = client.messages.stream(apiParams);

        // Async generator yields string text deltas from the provider stream
        async function* chunks(): AsyncGenerator<RillValue> {
          try {
            for await (const event of sdkStream) {
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
              ) {
                yield event.delta.text;
              }
            }
          } catch (error: unknown) {
            const rillError = mapProviderError(
              'Anthropic',
              error,
              detectAnthropicError
            );
            throw rillError;
          }
        }

        // Resolve callback — returns the same dict shape as the pre-streaming return
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await sdkStream.finalMessage();

            const content = extractTextContent(
              response.content as Array<{ type: string; text?: string }>
            );

            const result = {
              content,
              model: response.model,
              usage: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
              },
              stop_reason: response.stop_reason,
              id: response.id,
              messages: buildResponseMessages(
                msgList.map((m) => ({
                  role: m['role'] as string,
                  content: m['content'] as string,
                })),
                content
              ),
            };

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:messages',
              subsystem: 'extension:anthropic',
              duration,
              model: response.model,
              usage: result.usage,
              request: apiMessages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError = mapProviderError(
              'Anthropic',
              error,
              detectAnthropicError
            );

            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: rillError.message,
              duration,
            });

            throw rillError;
          }
        };

        const retTypeStructure = {
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
          dispose: () => { sdkStream.abort(); },
          chunkType: { kind: 'string' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Send multi-turn conversation to Claude API' },
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

    // IR-6: anthropic::embed
    embed: {
      params: [p.str('text')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract argument
          const text = args['text'] as string;

          // Validate using shared validation functions (wrapped to use RILL-R004)
          wrapValidation(validateEmbedText)(text);
          wrapValidation(validateEmbedModel)(factoryEmbedModel);

          // NOTE: Anthropic does not currently provide a public embeddings API.
          // This implementation is prepared for when/if the API becomes available.
          // The spec requires these functions, so we implement the interface.
          // For now, this will raise an error indicating unsupported operation.
          throw new RuntimeError(
            'RILL-R004',
            'Anthropic: embeddings API not available'
          );

          // Future implementation when API available:
          // Import createVector from '@rcrsr/rill' at top of file
          // const response = await client.embeddings.create({
          //   model: factoryEmbedModel,
          //   input: text,
          // });
          //
          // const vector = createVector(
          //   new Float32Array(response.embedding),
          //   factoryEmbedModel
          // );
          //
          // const duration = Date.now() - startTime;
          // emitExtensionEvent(ctx as RuntimeContext, {
          //   event: 'anthropic:embed',
          //   subsystem: 'extension:anthropic',
          //   duration,
          //   model: factoryEmbedModel,
          //   dimensions: response.embedding.length,
          // });
          //
          // return vector as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;

          // If already a RuntimeError, use it directly (validation errors)
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vector for text' },
      returnType: structureToTypeValue({ kind: 'vector' }),
    },

    // IR-7: anthropic::embed_batch
    embed_batch: {
      params: [p.list('texts')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract argument
          const texts = args['texts'] as RillValue[];

          // AC-24: Empty list returns empty list without API call
          if (texts.length === 0) {
            return [] as RillValue;
          }

          // Validate using shared validation functions (wrapped to use RILL-R004)
          wrapValidation(validateEmbedBatch)(texts);
          wrapValidation(validateEmbedModel)(factoryEmbedModel);

          // NOTE: Anthropic does not currently provide a public embeddings API.
          // This implementation is prepared for when/if the API becomes available.
          throw new RuntimeError(
            'RILL-R004',
            'Anthropic: embeddings API not available'
          );

          // Future implementation when API available:
          // Import createVector from '@rcrsr/rill' at top of file
          // const response = await client.embeddings.createBatch({
          //   model: factoryEmbedModel,
          //   input: texts as string[],
          // });
          //
          // const vectors = response.embeddings.map((embedding: number[]) =>
          //   createVector(new Float32Array(embedding), factoryEmbedModel)
          // );
          //
          // const duration = Date.now() - startTime;
          // emitExtensionEvent(ctx as RuntimeContext, {
          //   event: 'anthropic:embed_batch',
          //   subsystem: 'extension:anthropic',
          //   duration,
          //   model: factoryEmbedModel,
          //   dimensions: response.embeddings[0]?.length ?? 0,
          //   count: vectors.length,
          // });
          //
          // return vectors as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;

          // If already a RuntimeError, use it directly (validation errors)
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vectors for multiple texts' },
      returnType: structureToTypeValue({ kind: 'list' }),
    },

    // IR-8: anthropic::tool_loop
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

        // EC-22: Empty prompt raises error before stream creation
        if (prompt.trim().length === 0) {
          throw new RuntimeError('RILL-R004', 'prompt text cannot be empty');
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
        const messages: Anthropic.MessageParam[] = [];

        if ('messages' in options && Array.isArray(options['messages'])) {
          const prependedMessages = options['messages'] as Array<
            Record<string, unknown>
          >;

          for (const msg of prependedMessages) {
            if (!msg || typeof msg !== 'object' || !('role' in msg)) {
              throw new RuntimeError(
                'RILL-R004',
                "message missing required 'role' field"
              );
            }

            const role = msg['role'];
            if (role !== 'user' && role !== 'assistant') {
              throw new RuntimeError('RILL-R004', `invalid role '${role}'`);
            }

            if (!('content' in msg) || typeof msg['content'] !== 'string') {
              throw new RuntimeError(
                'RILL-R004',
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

        // Define Anthropic-specific callbacks for shared tool loop
        const callbacks: ToolLoopCallbacks = {
          // Build Anthropic Tool format from tool definitions
          buildTools: (
            toolDefs: Array<{
              name: string;
              description: string;
              input_schema: object;
            }>
          ): Anthropic.Tool[] => {
            return toolDefs.map((def) => ({
              name: def.name,
              description: def.description,
              input_schema: def.input_schema as Anthropic.Tool.InputSchema,
            }));
          },

          // Call Anthropic API (non-streaming path)
          callAPI: async (
            msgs: unknown[],
            tools: unknown
          ): Promise<unknown> => {
            const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
              model: factoryModel,
              max_tokens: maxTokens,
              messages: msgs as Anthropic.MessageParam[],
              tools: tools as Anthropic.Tool[],
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }
            if (system !== undefined) {
              apiParams.system = system;
            }

            return await client.messages.create(apiParams);
          },

          // Call Anthropic API with streaming text deltas (streaming path)
          callAPIStreaming: async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void
          ): Promise<unknown> => {
            const apiParams: Anthropic.MessageStreamParams = {
              model: factoryModel,
              max_tokens: maxTokens,
              messages: msgs as Anthropic.MessageParam[],
              tools: tools as Anthropic.Tool[],
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }
            if (system !== undefined) {
              apiParams.system = system;
            }

            const sdkStream = client.messages.stream(apiParams);
            sdkStream.on('text', (textDelta: string) => {
              onTextDelta(textDelta);
            });
            return await sdkStream.finalMessage();
          },

          // Extract tool calls from Anthropic response
          extractToolCalls: (
            response: unknown
          ): Array<{ id: string; name: string; input: object }> | null => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('content' in response)
            ) {
              return null;
            }

            const content = (response as { content: unknown[] }).content;
            if (!Array.isArray(content)) {
              return null;
            }

            const toolUseBlocks = content.filter(
              (block): block is Anthropic.ToolUseBlock =>
                typeof block === 'object' &&
                block !== null &&
                'type' in block &&
                block.type === 'tool_use'
            );

            if (toolUseBlocks.length === 0) {
              return null;
            }

            return toolUseBlocks.map((block) => ({
              id: block.id,
              name: block.name,
              input: block.input as object,
            }));
          },

          // Extract assistant message from Anthropic response for conversation history
          formatAssistantMessage: (response: unknown): unknown => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('role' in response) ||
              !('content' in response)
            ) {
              return null;
            }

            const r = response as { role: unknown; content: unknown };
            return { role: r.role, content: r.content };
          },

          // Format tool results into Anthropic message format
          formatToolResult: (
            toolResults: Array<{
              id: string;
              name: string;
              result: RillValue;
              error?: string;
            }>
          ): unknown => {
            // Convert tool results to Anthropic tool_result content blocks
            const content: Anthropic.ToolResultBlockParam[] = toolResults.map(
              (tr) => ({
                type: 'tool_result' as const,
                tool_use_id: tr.id,
                content: tr.error
                  ? `Error: ${tr.error}`
                  : JSON.stringify(tr.result),
                is_error: tr.error !== undefined,
              })
            );

            // Return user message with tool results
            return {
              role: 'user' as const,
              content,
            };
          },
        };

        // Shared event emitter used by both the streaming loop and resolve()
        const emitEventFn = (event: string, data: Record<string, unknown>): void => {
          const eventMap: Record<string, string> = {
            tool_call: 'anthropic:tool_call',
            tool_result: 'anthropic:tool_result',
          };
          emitExtensionEvent(ctx as RuntimeContext, {
            event: eventMap[event] || event,
            subsystem: 'extension:anthropic',
            ...data,
          });
        };

        // Start the tool loop immediately with streaming enabled.
        // Both chunks() and resolve() share this single execution — tools run once.
        const collected: RillValue[] = [];
        let wakeUp: (() => void) | undefined;
        let loopDone = false;

        const yieldChunkFn = (chunk: RillValue): void => {
          collected.push(chunk);
          if (wakeUp !== undefined) {
            wakeUp();
            wakeUp = undefined;
          }
        };

        const sharedLoopPromise = executeToolLoop(
          messages,
          toolsDict as RillValue,
          maxErrors,
          callbacks,
          emitEventFn,
          maxTurns,
          ctx,
          yieldChunkFn
        );

        // Signal the drain loop when the tool loop finishes
        sharedLoopPromise.then(
          () => { loopDone = true; if (wakeUp !== undefined) { wakeUp(); wakeUp = undefined; } },
          () => { loopDone = true; if (wakeUp !== undefined) { wakeUp(); wakeUp = undefined; } }
        );

        // Async generator drains chunks collected by yieldChunkFn
        async function* chunks(): AsyncGenerator<RillValue> {
          // Drain collected chunks; suspend when empty and loop still running
          while (!loopDone || collected.length > 0) {
            if (collected.length > 0) {
              yield collected.shift()!;
            } else if (!loopDone) {
              await new Promise<void>((r) => { wakeUp = r; });
            }
          }
          // Propagate any error thrown by the tool loop
          await sharedLoopPromise;
        }

        // Resolve callback — called after chunk exhaustion or on direct invocation.
        // Awaits the shared loop promise to build the result dict.
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await sharedLoopPromise;

            // Extract response data
            const response = loopResult.response as Anthropic.Message | null;
            const content = response
              ? extractTextContent(
                  response.content as Array<{ type: string; text?: string }>
                )
              : '';

            const inputMessages = messages.map((m) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            }));

            const result = {
              content,
              model: response ? response.model : factoryModel,
              usage: loopResult.totalTokens,
              stop_reason: response ? response.stop_reason : 'max_turns',
              turns: loopResult.turns,
              messages: response
                ? buildResponseMessages(inputMessages, content)
                : inputMessages,
            };

            // Emit tool_loop event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:tool_loop',
              subsystem: 'extension:anthropic',
              turns: result.turns,
              total_duration: duration,
              usage: result.usage,
              request: messages,
              content,
            });

            return result as RillValue;
          } catch (error: unknown) {
            const duration = Date.now() - startTime;
            const rillError =
              error instanceof RuntimeError
                ? error
                : mapProviderError('Anthropic', error, detectAnthropicError);

            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: rillError.message,
              duration,
            });

            throw rillError;
          }
        };

        const retTypeStructure = {
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
          dispose: () => { /* stream is self-contained, no external resource to abort */ },
          chunkType: { kind: 'dict' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Execute tool-use loop with Claude API' },
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

    // IR-3: anthropic::generate
    generate: {
      params: [
        p.str('prompt'),
        p.dict('options', undefined, {}, {
          schema: { type: { kind: 'dict' } },
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
          const options = (args['options'] ?? {}) as Record<string, unknown>;

          // EC-3: Validate schema option is present
          if (
            !('schema' in options) ||
            options['schema'] === null ||
            options['schema'] === undefined
          ) {
            throw new RuntimeError(
              'RILL-R004',
              "generate requires 'schema' option"
            );
          }

          // EC-4: Build JSON Schema — delegates type validation to buildJsonSchema
          const rillSchema = options['schema'] as Record<string, unknown>;
          const jsonSchema = buildJsonSchema(rillSchema);

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
              ? options['max_tokens']
              : factoryMaxTokens;

          // Build messages array: prepend conversation context if provided
          const apiMessages: Anthropic.MessageParam[] = [];

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<
              Record<string, unknown>
            >;

            for (const msg of prependedMessages) {
              if (!msg || typeof msg !== 'object' || !('role' in msg)) {
                throw new RuntimeError(
                  'RILL-R004',
                  "message missing required 'role' field"
                );
              }

              const role = msg['role'];
              if (role !== 'user' && role !== 'assistant') {
                throw new RuntimeError('RILL-R004', `invalid role '${role}'`);
              }

              if (!('content' in msg) || typeof msg['content'] !== 'string') {
                throw new RuntimeError(
                  'RILL-R004',
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

          // Call Anthropic API with native structured output
          const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: maxTokens,
            messages: apiMessages,
            output_config: {
              format: {
                type: 'json_schema',
                schema: jsonSchema as unknown as { [key: string]: unknown },
              },
            },
          };

          // Add optional parameters only if defined
          if (factoryTemperature !== undefined) {
            apiParams.temperature = factoryTemperature;
          }
          if (system !== undefined) {
            apiParams.system = system;
          }

          const response = await client.messages.create(apiParams);

          // Extract JSON string from response content text block (AC-8)
          const raw = extractTextContent(
            response.content as Array<{ type: string; text?: string }>
          );

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
              'RILL-R004',
              `generate: failed to parse response JSON: ${detail}`
            );
          }

          // Build 6-key response dict (AC-6, AC-7)
          const result = {
            data,
            raw,
            model: response.model,
            usage: {
              input: response.usage.input_tokens,
              output: response.usage.output_tokens,
            },
            stop_reason: response.stop_reason,
            id: response.id,
          };

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:generate',
            subsystem: 'extension:anthropic',
            duration,
            model: response.model,
            usage: result.usage,
            request: apiMessages,
            content: raw,
          });

          return result as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError =
            error instanceof RuntimeError
              ? error
              : mapProviderError('Anthropic', error, detectAnthropicError);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: rillError.message,
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate structured output from Anthropic API' },
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
