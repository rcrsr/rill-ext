/**
 * Extension factory for Anthropic Claude API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  RuntimeError,
  RuntimeHaltSignal,
  createRillStream,
  emitExtensionEvent,
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
  validateEmbedBatch,
  validateEmbedModel,
  mapProviderError,
  throwIfCancelledByDispose,
  throwProviderHalt,
  executeToolLoop,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  normalizePrompt,
  RESERVED_KEYS_COMMON,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
  type ToolLoopCallbacks,
  type Message,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import {
  GENERATE_RETURN_TYPE_STRUCTURE,
  MESSAGE_RET_TYPE_STRUCTURE,
  TOOL_LOOP_RET_TYPE_STRUCTURE,
  anthropicContentToParts,
  canonicalToAnthropicMessages,
  detectAnthropicError,
  extractTextContent,
  haltInvalid,
  runInFnValidation,
} from './provider-helpers.js';
import type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 4096;

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Anthropic extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, embed, embed_batch, tool_loop, generate and dispose
 * @throws RuntimeError for invalid configuration
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
  // Validate factory max_turns BEFORE client creation
  validateMaxTurns(config.max_turns);

  // Validate factory max_errors BEFORE client creation; reject 0/negative/non-integer
  validateMaxErrors(config.max_errors);

  // Validate extra keys BEFORE client creation
  validateExtraKeys(config.extra, RESERVED_KEYS_COMMON);

  // Validate required fields
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time
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
  const factoryMaxTurns = config.max_turns;
  const factoryMaxErrors = config.max_errors ?? 3;

  // AbortController for cancelling in-flight requests; cleared by dispose().
  let abortController: AbortController | undefined = new AbortController();

  // Dispose function for cleanup: aborts every in-flight vendor request.
  const dispose = (): Promise<void> => {
    try {
      if (abortController) {
        abortController.abort();
        abortController = undefined;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to abort Anthropic requests: ${message}`);
    }
    return Promise.resolve();
  };

  // Reject calls after dispose() so requests do not proceed on a disposed
  // extension.
  function assertNotDisposed(ctx: RuntimeContext): void {
    if (!abortController) {
      throw haltInvalid(
        ctx,
        'DISPOSED',
        'extension_disposed',
        'anthropic: extension disposed'
      );
    }
  }

  // Called first in every catch block. Reports #DISPOSED only when dispose()
  // is what cancelled the call; an error that happened before dispose, or a
  // non-abort failure that settles after it, keeps its original classification.
  // Emits anthropic:error when startTime is supplied.
  function haltIfCancelledByDispose(
    ctx: RuntimeContext,
    error: unknown,
    startTime?: number
  ): void {
    throwIfCancelledByDispose(
      ctx,
      'anthropic',
      error,
      abortController === undefined,
      () => {
        if (startTime !== undefined) {
          emitExtensionEvent(ctx, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: 'anthropic: extension disposed',
            duration: Date.now() - startTime,
          });
        }
      }
    );
  }

  // Return extension result — satisfies verifies contract at compile time
  const fnDict: {
    message: RillFunction;
    embed: RillFunction;
    embed_batch: RillFunction;
    tool_loop: RillFunction;
    generate: RillFunction;
  } = {
    // message: accepts string OR list of message dicts (canonical or content-sugar)
    message: {
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
        // Normalize prompt: string → [{role:'user', parts:[{type:'text', text}]}]
        //                   list  → canonical Message[]
        const rawPrompt = args['prompt'] as RillValue;
        const normalized = normalizePrompt(rawPrompt, ctx);

        // normalizePrompt returns an invalid RillValue on failure — halt immediately
        if (!Array.isArray(normalized)) {
          throw new RuntimeHaltSignal(normalized, true);
        }

        const messages = normalized as Message[];

        // Translate to Anthropic wire format
        const { apiMessages, systemText } =
          canonicalToAnthropicMessages(messages);

        // Determine effective system
        const effectiveSystem =
          systemText !== undefined ? systemText : factorySystem;

        // Build API parameters
        const apiParams: Anthropic.MessageStreamParams = {
          model: factoryModel,
          max_tokens: factoryMaxTokens,
          messages: apiMessages,
        };

        if (factoryTemperature !== undefined) {
          apiParams.temperature = factoryTemperature;
        }
        if (effectiveSystem !== undefined) {
          apiParams.system = effectiveSystem;
        }

        // Create the Anthropic streaming request (lazy — SDK starts on first iteration)
        const sdkStream = client.messages.stream(apiParams, {
          signal: abortController!.signal,
        });

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
            haltIfCancelledByDispose(ctx, error);
            throwProviderHalt(ctx, 'Anthropic', error, detectAnthropicError);
          }
        }

        // Resolve callback — returns the final result dict
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const response = await sdkStream.finalMessage();

            // Build canonical assistant parts from response content
            const assistantParts = anthropicContentToParts(response.content);

            // Build canonical messages list: input + assistant reply
            const responseMessages = buildResponseMessages(
              messages,
              assistantParts
            );

            const result = {
              model: response.model,
              usage: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
              },
              stop_reason: response.stop_reason,
              id: response.id,
              messages: responseMessages,
            };

            // Emit success event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx, {
              event: 'anthropic:message',
              subsystem: 'extension:anthropic',
              duration,
              model: response.model,
              usage: result.usage,
              request: apiMessages,
            });

            return result as unknown as RillValue;
          } catch (error: unknown) {
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;
            const invalid = mapProviderError(
              ctx,
              'Anthropic',
              error,
              detectAnthropicError
            );

            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
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
            sdkStream.abort();
          },
          chunkType: { kind: 'string' },
          retType: MESSAGE_RET_TYPE_STRUCTURE,
        });
      },
      annotations: {
        description: 'Send single or multi-turn message to Claude API',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: MESSAGE_RET_TYPE_STRUCTURE,
      }),
    },

    // embed: generate embedding vector for text
    embed: {
      params: [p.str('text')],
      fn: (args, ctx): Promise<RillValue> => {
        const run = (): RillValue => {
          assertNotDisposed(ctx);
          const startTime = Date.now();

          try {
            // Extract argument
            const text = args['text'] as string;

            // Validate using shared validation functions; convert R001 → ctx.invalidate
            runInFnValidation(
              ctx,
              () => validateEmbedText(text),
              'invalid_embed_text'
            );
            runInFnValidation(
              ctx,
              () => validateEmbedModel(factoryEmbedModel),
              'invalid_embed_model'
            );

            // NOTE: Anthropic does not currently provide a public embeddings API.
            // This implementation is prepared for when/if the API becomes available.
            throw haltInvalid(
              ctx,
              'UNAVAILABLE',
              'feature_unavailable',
              'Anthropic: embeddings API not available'
            );
          } catch (error: unknown) {
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;

            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }

            if (error instanceof RuntimeError) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: error.message,
                duration,
              });
              throw error;
            }

            const invalid = mapProviderError(
              ctx,
              'Anthropic',
              error,
              detectAnthropicError
            );
            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };
        return new Promise<RillValue>((resolve) => {
          resolve(run());
        });
      },
      annotations: { description: 'Generate embedding vector for text' },
      returnType: structureToTypeValue({ kind: 'vector' }),
    },

    // embed_batch: generate embedding vectors for multiple texts
    embed_batch: {
      params: [p.list('texts')],
      fn: (args, ctx): Promise<RillValue> => {
        const run = (): RillValue => {
          assertNotDisposed(ctx);
          const startTime = Date.now();

          try {
            // Extract argument
            const texts = args['texts'] as RillValue[];

            // Empty list returns empty list without API call
            if (texts.length === 0) {
              return [] as RillValue;
            }

            // Validate using shared validation functions; convert R001 → ctx.invalidate
            runInFnValidation(
              ctx,
              () => {
                validateEmbedBatch(texts);
              },
              'invalid_embed_batch'
            );
            runInFnValidation(
              ctx,
              () => validateEmbedModel(factoryEmbedModel),
              'invalid_embed_model'
            );

            // NOTE: Anthropic does not currently provide a public embeddings API.
            throw haltInvalid(
              ctx,
              'UNAVAILABLE',
              'feature_unavailable',
              'Anthropic: embeddings API not available'
            );
          } catch (error: unknown) {
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;

            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }

            if (error instanceof RuntimeError) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: error.message,
                duration,
              });
              throw error;
            }

            const invalid = mapProviderError(
              ctx,
              'Anthropic',
              error,
              detectAnthropicError
            );
            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: getStatus(invalid).message,
              duration,
            });
            throw new RuntimeHaltSignal(invalid, true);
          }
        };
        return new Promise<RillValue>((resolve) => {
          resolve(run());
        });
      },
      annotations: {
        description: 'Generate embedding vectors for multiple texts',
      },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'vector' },
      }),
    },

    // tool_loop: multi-turn tool-calling loop
    // max_turns: positional number param, default 0 sentinel (no per-call override)
    tool_loop: {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        {
          name: 'tools',
          type: { kind: 'dict', valueType: { kind: 'closure' } },
          defaultValue: undefined,
          annotations: {},
        },
        p.num('max_turns', undefined, 0),
      ],
      fn: (args, ctx): RillValue => {
        assertNotDisposed(ctx);
        // Extract arguments
        const rawPrompt = args['prompt'] as RillValue;
        const toolsDict = args['tools'] as RillValue;
        const maxTurnsArg = args['max_turns'] as number;

        // Negative per-call max_turns → INVALID_INPUT
        if (typeof maxTurnsArg === 'number' && maxTurnsArg < 0) {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'invalid_max_turns',
            'max_turns must be >= 0 (use 0 for no per-call override)'
          );
        }

        // Empty tools dict → INVALID_INPUT
        if (
          typeof toolsDict === 'object' &&
          toolsDict !== null &&
          !Array.isArray(toolsDict) &&
          Object.keys(toolsDict).length === 0
        ) {
          throw haltInvalid(
            ctx,
            'INVALID_INPUT',
            'empty_tools_dict',
            'tool_loop: tools dict must not be empty'
          );
        }

        // Normalize prompt
        const normalized = normalizePrompt(rawPrompt, ctx);

        // normalizePrompt returns invalid RillValue on failure
        if (!Array.isArray(normalized)) {
          throw new RuntimeHaltSignal(normalized, true);
        }

        const canonicalMessages = normalized as Message[];

        // Translate to Anthropic wire format
        const { apiMessages, systemText } =
          canonicalToAnthropicMessages(canonicalMessages);

        // Determine effective system
        const effectiveSystem =
          systemText !== undefined ? systemText : factorySystem;

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
            tools: unknown,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
              model: factoryModel,
              max_tokens: factoryMaxTokens,
              messages: msgs as Anthropic.MessageParam[],
              tools: tools as Anthropic.Tool[],
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }
            if (effectiveSystem !== undefined) {
              apiParams.system = effectiveSystem;
            }

            return await client.messages.create(apiParams, { signal });
          },

          // Call Anthropic API with streaming text deltas
          callAPIStreaming: async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const apiParams: Anthropic.MessageStreamParams = {
              model: factoryModel,
              max_tokens: factoryMaxTokens,
              messages: msgs as Anthropic.MessageParam[],
              tools: tools as Anthropic.Tool[],
            };

            if (factoryTemperature !== undefined) {
              apiParams.temperature = factoryTemperature;
            }
            if (effectiveSystem !== undefined) {
              apiParams.system = effectiveSystem;
            }

            const sdkStream = client.messages.stream(apiParams, { signal });
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
              typeof response !== 'object' ||
              response === null ||
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
              typeof response !== 'object' ||
              response === null ||
              !('role' in response) ||
              !('content' in response)
            ) {
              return null;
            }

            const r = response;
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
                content:
                  tr.error !== undefined && tr.error !== ''
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

        // Shared event emitter
        const emitEventFn = (
          event: string,
          data: Record<string, unknown>
        ): void => {
          const eventMap: Record<string, string> = {
            tool_call: 'anthropic:tool_call',
            tool_result: 'anthropic:tool_result',
          };
          emitExtensionEvent(ctx, {
            event: eventMap[event] ?? event,
            subsystem: 'extension:anthropic',
            ...data,
          });
        };

        // Start the tool loop immediately with streaming enabled.
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

        const toolLoopAbortController = new AbortController();

        const sharedLoopPromise = executeToolLoop(
          apiMessages,
          toolsDict,
          factoryMaxErrors,
          callbacks,
          emitEventFn,
          maxTurnsArg,
          ctx,
          yieldChunkFn,
          AbortSignal.any([
            abortController!.signal,
            toolLoopAbortController.signal,
          ]),
          factoryMaxTurns
        );

        // Signal the drain loop when the tool loop finishes
        void sharedLoopPromise.then(
          () => {
            loopDone = true;
            if (wakeUp !== undefined) {
              wakeUp();
              wakeUp = undefined;
            }
          },
          () => {
            loopDone = true;
            if (wakeUp !== undefined) {
              wakeUp();
              wakeUp = undefined;
            }
          }
        );

        // Async generator drains chunks collected by yieldChunkFn
        async function* chunks(): AsyncGenerator<RillValue> {
          while (!loopDone || collected.length > 0) {
            if (collected.length > 0) {
              yield collected.shift()!;
            } else if (!loopDone) {
              await new Promise<void>((r) => {
                wakeUp = r;
              });
            }
          }
          // Propagate any error thrown by the tool loop; a call cancelled by
          // dispose() reports #DISPOSED.
          try {
            await sharedLoopPromise;
          } catch (error: unknown) {
            haltIfCancelledByDispose(ctx, error);
            throw error;
          }
        }

        // Resolve callback — builds final result dict
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          try {
            const loopResult = await sharedLoopPromise;

            // Extract response data
            const response = loopResult.response as Anthropic.Message | null;

            // Build canonical assistant parts from final response
            const assistantParts = response
              ? anthropicContentToParts(response.content)
              : [{ type: 'text' as const, text: '' }];

            // Build full transcript: input canonical messages + assistant reply
            const responseMessages = buildResponseMessages(
              canonicalMessages,
              assistantParts
            );

            const result = {
              model: response ? response.model : factoryModel,
              usage: loopResult.totalTokens,
              stop_reason: response ? response.stop_reason : 'max_turns',
              id: response ? response.id : '',
              turns: loopResult.turns,
              messages: responseMessages,
            };

            // Emit tool_loop event
            const duration = Date.now() - startTime;
            emitExtensionEvent(ctx, {
              event: 'anthropic:tool_loop',
              subsystem: 'extension:anthropic',
              turns: result.turns,
              total_duration: duration,
              usage: result.usage,
              request: apiMessages,
            });

            return result as unknown as RillValue;
          } catch (error: unknown) {
            haltIfCancelledByDispose(ctx, error, startTime);
            const duration = Date.now() - startTime;
            if (error instanceof RuntimeError) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: error.message,
                duration,
              });
              throw error;
            }
            if (error instanceof RuntimeHaltSignal) {
              emitExtensionEvent(ctx, {
                event: 'anthropic:error',
                subsystem: 'extension:anthropic',
                error: getStatus(error.value).message,
                duration,
              });
              throw error;
            }
            const invalid = mapProviderError(
              ctx,
              'Anthropic',
              error,
              detectAnthropicError
            );
            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
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
            toolLoopAbortController.abort();
          },
          chunkType: { kind: 'dict' },
          retType: TOOL_LOOP_RET_TYPE_STRUCTURE,
        });
      },
      annotations: { description: 'Execute tool-use loop with Claude API' },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'dict' },
        ret: TOOL_LOOP_RET_TYPE_STRUCTURE,
      }),
    },

    // generate: structured output from Anthropic API
    generate: {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
        {
          name: 'schema',
          type: { kind: 'type' },
          defaultValue: undefined,
          annotations: {
            description: 'Type expression for structured output schema',
          },
        },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        assertNotDisposed(ctx);
        const startTime = Date.now();

        try {
          // Extract arguments
          const rawPrompt = args['prompt'] as RillValue;
          const schemaArg = args['schema'] as
            | { __rill_type?: boolean; structure?: TypeStructure }
            | undefined;

          // Validate schema is a type value with dict structure
          if (
            schemaArg === undefined ||
            schemaArg.__rill_type !== true ||
            schemaArg.structure === undefined
          ) {
            throw haltInvalid(
              ctx,
              'INVALID_INPUT',
              'invalid_schema',
              'generate requires a type expression as schema'
            );
          }
          if (schemaArg.structure.kind !== 'dict') {
            throw haltInvalid(
              ctx,
              'INVALID_INPUT',
              'invalid_schema_type',
              `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
            );
          }

          // Build JSON Schema from TypeStructure
          const jsonSchema = buildJsonSchemaFromStructuralType(
            schemaArg.structure
          );

          // Normalize prompt
          const normalized = normalizePrompt(rawPrompt, ctx);
          if (!Array.isArray(normalized)) {
            throw new RuntimeHaltSignal(normalized, true);
          }

          const canonicalMessages = normalized as Message[];

          // Translate to Anthropic wire format
          const { apiMessages, systemText } =
            canonicalToAnthropicMessages(canonicalMessages);
          const effectiveSystem =
            systemText !== undefined ? systemText : factorySystem;

          // Call Anthropic API with native structured output
          const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: factoryModel,
            max_tokens: factoryMaxTokens,
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
          if (effectiveSystem !== undefined) {
            apiParams.system = effectiveSystem;
          }

          // Streaming is not supported for structured output (PROTOCOL)
          // The Anthropic API returns structured output synchronously; if we somehow
          // get a streaming response, that is an unexpected format.
          const response = await client.messages.create(apiParams, {
            signal: abortController!.signal,
          });

          // Validate response is not a stream
          if (
            typeof (response as unknown as { stream?: unknown }).stream ===
            'function'
          ) {
            throw haltInvalid(
              ctx,
              'PROTOCOL',
              'unexpected_response_format',
              'generate: provider returned a streaming response for structured output'
            );
          }

          // Extract JSON string from response content text block
          const raw = extractTextContent(response.content);

          // Parse JSON, throw on failure with schema_validation_failed kind
          let data: unknown;
          try {
            data = JSON.parse(raw) as unknown;
          } catch (parseError: unknown) {
            const detail =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            throw haltInvalid(
              ctx,
              'PROTOCOL',
              'schema_validation_failed',
              `generate: failed to parse response JSON: ${detail}`
            );
          }

          // Build canonical assistant parts from response
          const assistantParts = anthropicContentToParts(response.content);

          // Build messages: input + assistant reply (length ≥ 2, ends with assistant text part containing raw)
          const responseMessages = buildResponseMessages(
            canonicalMessages,
            assistantParts
          );

          // Build result dict with data, raw, messages, model, usage, stop_reason, id
          const result = {
            data,
            raw,
            messages: responseMessages,
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
          emitExtensionEvent(ctx, {
            event: 'anthropic:generate',
            subsystem: 'extension:anthropic',
            duration,
            model: response.model,
            usage: result.usage,
            request: apiMessages,
            content: raw,
          });

          return result as unknown as RillValue;
        } catch (error: unknown) {
          haltIfCancelledByDispose(ctx, error, startTime);
          const duration = Date.now() - startTime;
          if (error instanceof RuntimeError) {
            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: error.message,
              duration,
            });
            throw error;
          }
          if (error instanceof RuntimeHaltSignal) {
            emitExtensionEvent(ctx, {
              event: 'anthropic:error',
              subsystem: 'extension:anthropic',
              error: getStatus(error.value).message,
              duration,
            });
            throw error;
          }
          const invalid = mapProviderError(
            ctx,
            'Anthropic',
            error,
            detectAnthropicError
          );
          emitExtensionEvent(ctx, {
            event: 'anthropic:error',
            subsystem: 'extension:anthropic',
            error: getStatus(invalid).message,
            duration,
          });
          throw new RuntimeHaltSignal(invalid, true);
        }
      },
      annotations: {
        description: 'Generate structured output from Anthropic API',
      },
      returnType: structureToTypeValue(GENERATE_RETURN_TYPE_STRUCTURE),
    },
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
