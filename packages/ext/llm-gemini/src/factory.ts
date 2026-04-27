/**
 * Extension factory for Gemini API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import {
  GoogleGenAI,
  Type,
  type FunctionDeclaration,
  type Content,
  type Part,
  type Schema,
} from '@google/genai';
import {
  RuntimeError,
  RuntimeHaltSignal,
  emitExtensionEvent,
  createRillStream,
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
  validateEmbedBatch,
  validateEmbedModel,
  mapProviderError,
  executeToolLoop,
  buildJsonSchemaFromStructuralType,
  buildResponseMessages,
  type JsonSchemaProperty,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { GeminiExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 8192;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map a non-RuntimeError into an invalid RillValue + halt signal pair so
 * factory call sites can capture the halt for later re-throw while still
 * emitting events with the human-readable message.
 */
function mapToHalt(
  ctx: RuntimeContext,
  error: unknown
): RuntimeHaltSignal {
  const invalid = mapProviderError(ctx, 'Gemini', error, detectGeminiError);
  return new RuntimeHaltSignal(invalid, true);
}

function streamErrorMessage(
  err: RuntimeError | RuntimeHaltSignal | undefined
): string {
  if (err === undefined) return '';
  if (err instanceof RuntimeHaltSignal) {
    return getStatus(err.value).message || err.message;
  }
  return err.message;
}

/**
 * Gemini-specific error detector for mapProviderError.
 * Extracts status code and message using string pattern matching.
 *
 * @param error - Unknown error value
 * @returns Object with status and message if Gemini error, null otherwise
 */
const detectGeminiError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof Error) {
    const message = error.message;

    // Extract status code if present in message
    const statusMatch = message.match(/\((\d{3})\)/);
    if (statusMatch && statusMatch[1]) {
      return {
        status: parseInt(statusMatch[1], 10),
        message,
      };
    }

    return {
      message,
    };
  }
  return null;
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert a JsonSchemaProperty (string type names) to a Gemini Schema
 * (Type enum values). Mirrors the type-mapping pattern in buildTools.
 */
function toGeminiSchema(prop: JsonSchemaProperty): Schema {
  // Map JSON Schema type string to Gemini Type enum
  let schemaType = Type.STRING;
  if (prop.type === 'number') schemaType = Type.NUMBER;
  if (prop.type === 'boolean') schemaType = Type.BOOLEAN;
  if (prop.type === 'integer') schemaType = Type.INTEGER;
  if (prop.type === 'array') schemaType = Type.ARRAY;
  if (prop.type === 'object') schemaType = Type.OBJECT;

  const schema: Schema = { type: schemaType };

  if (prop.description !== undefined) {
    schema.description = prop.description;
  }

  if (prop.enum !== undefined) {
    schema.enum = prop.enum;
  }

  if (prop.type === 'array' && prop.items !== undefined) {
    schema.items = toGeminiSchema(prop.items);
  }

  if (prop.type === 'object' && prop.properties !== undefined) {
    const nestedProperties: Record<string, Schema> = {};
    for (const [key, nestedProp] of Object.entries(prop.properties)) {
      nestedProperties[key] = toGeminiSchema(nestedProp);
    }
    schema.properties = nestedProperties;
    if (prop.required !== undefined) {
      schema.required = prop.required;
    }
  }

  return schema;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Gemini extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, messages, embed, embed_batch, tool_loop and dispose
 * @throws Error for invalid configuration (EC-1 through EC-4)
 *
 * @example
 * ```typescript
 * const ext = createGeminiExtension({
 *   api_key: process.env.GOOGLE_API_KEY,
 *   model: 'gemini-2.0-flash',
 *   temperature: 0.7
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createGeminiExtension(
  config: GeminiExtensionConfig
): ExtensionFactoryResult {
  // Validate required fields (§4.1)
  validateApiKey(config.api_key);
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Instantiate SDK client at factory time (§4.1)
  const client = new GoogleGenAI({
    apiKey: config.api_key,
  });

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;

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
      console.warn(`Failed to abort Gemini requests: ${message}`);
    }

    try {
      // Cleanup SDK HTTP connections
      // Note: Gemini SDK doesn't expose a close() method, but we include
      // this structure for consistency with extension pattern
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Gemini SDK: ${message}`);
    }
  };

  // Return extension result with implementations — satisfies verifies contract at compile time (IR-8)
  const fnDict: { message: RillFunction; messages: RillFunction; embed: RillFunction; embed_batch: RillFunction; tool_loop: RillFunction; generate: RillFunction } = ({
    // IR-4: gemini::message
    message: {
      params: [
        p.str('text'),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: async (args, ctx): Promise<RillValue> => {
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

        // Build Gemini API request
        const contents = [
          {
            role: 'user' as const,
            parts: [{ text }],
          },
        ];

        // Build config object with optional properties
        const apiConfig: {
          systemInstruction?: string;
          maxOutputTokens?: number;
          temperature?: number;
        } = {};

        if (system !== undefined) {
          apiConfig.systemInstruction = system;
        }
        if (maxTokens !== undefined) {
          apiConfig.maxOutputTokens = maxTokens;
        }
        if (factoryTemperature !== undefined) {
          apiConfig.temperature = factoryTemperature;
        }

        // Accumulate streamed text deltas for resolve
        const collectedChunks: string[] = [];
        let streamError: RuntimeError | RuntimeHaltSignal | undefined;

        // Per-call AbortController to cancel the provider request on dispose
        const streamAbortController = new AbortController();

        // Track stream start time for event emission
        const messageStartTime = Date.now();

        // Async generator yielding string text deltas from Gemini streaming API
        async function* streamChunks(): AsyncGenerator<RillValue> {
          try {
            const stream = await client.models.generateContentStream({
              model: factoryModel,
              contents,
              config: { ...apiConfig, abortSignal: streamAbortController.signal },
            });
            for await (const chunk of stream) {
              const delta = chunk.text ?? '';
              if (delta) {
                collectedChunks.push(delta);
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            // EC-2: Provider API error during stream — map and emit error event
            streamError =
              error instanceof RuntimeError || error instanceof RuntimeHaltSignal
                ? error
                : mapToHalt(ctx as RuntimeContext, error);
            const duration = Date.now() - messageStartTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'gemini:error',
              subsystem: 'extension:gemini',
              error: streamErrorMessage(streamError),
              duration,
            });
            throw streamError;
          }
        }

        // Resolve callback returns same dict shape as previous non-streaming return
        const resolve = async (): Promise<RillValue> => {
          if (streamError) {
            // EC-12: Provider failure during resolution
            throw streamError;
          }
          const duration = Date.now() - messageStartTime;
          const content = collectedChunks.join('');
          const result = {
            content,
            model: factoryModel,
            usage: {
              input: 0,
              output: 0,
            },
            stop_reason: 'stop',
            id: '',
            messages: buildResponseMessages(
              [
                ...(system ? [{ role: 'system', content: system }] : []),
                { role: 'user', content: text },
              ],
              content
            ),
          };

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:message',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: result.usage,
            request: contents,
            content,
          });

          return result as RillValue;
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
          chunks: streamChunks(),
          resolve,
          dispose: () => { streamAbortController.abort(); },
          chunkType: { kind: 'string' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Send single message to Gemini API' },
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

    // IR-5: gemini::messages
    messages: {
      params: [
        p.list('messages', { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } }),
        p.dict('options', undefined, {}, {
          system: { type: { kind: 'string' }, defaultValue: '' },
          max_tokens: { type: { kind: 'number' }, defaultValue: 0 },
        }),
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        // Extract arguments
        const inputMessages = args['messages'] as Array<Record<string, unknown>>;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // AC-23: Empty messages list raises error before stream creation
        if (inputMessages.length === 0) {
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

        // Build Gemini API contents array
        const contents: Array<{
          role: 'user' | 'model';
          parts: Array<{ text: string }>;
        }> = [];

        // Validate and transform messages before stream creation
        for (let i = 0; i < inputMessages.length; i++) {
          const msg = inputMessages[i];

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
            contents.push({
              role: 'user',
              parts: [{ text: msg['content'] as string }],
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

            if (hasContent) {
              contents.push({
                role: 'model',
                parts: [{ text: msg['content'] as string }],
              });
            }
          }
        }

        // Build config object with optional properties
        const apiConfig: {
          systemInstruction?: string;
          maxOutputTokens?: number;
          temperature?: number;
        } = {};

        if (system !== undefined) {
          apiConfig.systemInstruction = system;
        }
        if (maxTokens !== undefined) {
          apiConfig.maxOutputTokens = maxTokens;
        }
        if (factoryTemperature !== undefined) {
          apiConfig.temperature = factoryTemperature;
        }

        // Accumulate streamed text deltas for resolve
        const collectedChunks: string[] = [];
        let streamError: RuntimeError | RuntimeHaltSignal | undefined;

        // Per-call AbortController to cancel the provider request on dispose
        const streamAbortController = new AbortController();

        // Track stream start time for event emission
        const messagesStartTime = Date.now();

        // Async generator yielding string text deltas from Gemini streaming API
        async function* streamChunks(): AsyncGenerator<RillValue> {
          try {
            const stream = await client.models.generateContentStream({
              model: factoryModel,
              contents,
              config: { ...apiConfig, abortSignal: streamAbortController.signal },
            });
            for await (const chunk of stream) {
              const delta = chunk.text ?? '';
              if (delta) {
                collectedChunks.push(delta);
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            // EC-2: Provider API error during stream — map and emit error event
            streamError =
              error instanceof RuntimeError || error instanceof RuntimeHaltSignal
                ? error
                : mapToHalt(ctx as RuntimeContext, error);
            const duration = Date.now() - messagesStartTime;
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'gemini:error',
              subsystem: 'extension:gemini',
              error: streamErrorMessage(streamError),
              duration,
            });
            throw streamError;
          }
        }

        // Resolve callback returns same dict shape as previous non-streaming return
        const resolve = async (): Promise<RillValue> => {
          if (streamError) {
            // EC-12: Provider failure during resolution
            throw streamError;
          }
          const duration = Date.now() - messagesStartTime;
          const content = collectedChunks.join('');
          const result = {
            content,
            model: factoryModel,
            usage: {
              input: 0,
              output: 0,
            },
            stop_reason: 'stop',
            id: '',
            messages: buildResponseMessages(
              inputMessages.map((m) => ({
                role: m['role'] as string,
                content: (m['content'] as string) ?? '',
              })),
              content
            ),
          };

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:messages',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: result.usage,
            request: contents,
            content,
          });

          return result as RillValue;
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
          chunks: streamChunks(),
          resolve,
          dispose: () => { streamAbortController.abort(); },
          chunkType: { kind: 'string' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Send multi-turn conversation to Gemini API' },
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

    // IR-6: gemini::embed
    embed: {
      params: [p.str('text')],
      fn: async (args, ctx): Promise<RillValue> => {
        const startTime = Date.now();

        try {
          // Extract arguments
          const text = args['text'] as string;

          // Validate using shared functions
          validateEmbedText(text);
          validateEmbedModel(factoryEmbedModel);

          // Call Gemini embedContent API
          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: [text],
          });

          // Extract embedding data from response
          const embedding = response.embeddings?.[0];
          if (
            !embedding ||
            !embedding.values ||
            embedding.values.length === 0
          ) {
            throw new RuntimeError(
              'RILL-R005',
              'Gemini: empty embedding returned'
            );
          }

          // Convert to Float32Array and create RillVector
          const float32Data = new Float32Array(embedding.values);
          const vector = createVector(float32Data, factoryEmbedModel);

          // Emit success event
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:embed',
            subsystem: 'extension:gemini',
            duration,
            model: factoryEmbedModel,
            dimensions: float32Data.length,
          });

          return vector as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal =
            error instanceof RuntimeError
              ? error
              : mapToHalt(ctx as RuntimeContext, error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: streamErrorMessage(rillError),
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vector for text' },
      returnType: structureToTypeValue({ kind: 'vector' }),
    },

    // IR-7: gemini::embed_batch
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

          // Validate using shared functions
          validateEmbedModel(factoryEmbedModel);
          const stringTexts = validateEmbedBatch(texts);

          // Call Gemini embedContent API with array of texts
          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: stringTexts,
          });

          // Convert embeddings to RillVector list
          const vectors: RillValue[] = [];
          if (!response.embeddings || response.embeddings.length === 0) {
            throw new RuntimeError(
              'RILL-R005',
              'Gemini: empty embeddings returned'
            );
          }

          for (const embedding of response.embeddings) {
            if (
              !embedding ||
              !embedding.values ||
              embedding.values.length === 0
            ) {
              throw new RuntimeError(
                'RILL-R005',
                'Gemini: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embedding.values);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

          // Emit success event
          const duration = Date.now() - startTime;
          const firstVector = vectors[0];
          const dimensions =
            firstVector && isVector(firstVector) ? firstVector.data.length : 0;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:embed_batch',
            subsystem: 'extension:gemini',
            duration,
            model: factoryEmbedModel,
            dimensions,
            count: vectors.length,
          });

          return vectors as RillValue;
        } catch (error: unknown) {
          // Map error and emit failure event
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal =
            error instanceof RuntimeError
              ? error
              : mapToHalt(ctx as RuntimeContext, error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: streamErrorMessage(rillError),
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate embedding vectors for multiple texts' },
      returnType: structureToTypeValue({ kind: 'list', element: { kind: 'vector' } }),
    },

    // IR-8: gemini::tool_loop
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

        // EC-22: Validate prompt is non-empty before stream creation
        if (prompt.trim().length === 0) {
          throw new RuntimeError('RILL-R005', 'prompt text cannot be empty');
        }

        // Extract options with defaults
        const system =
          typeof options['system'] === 'string'
            ? options['system']
            : factorySystem;
        const maxTokens =
          typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
            ? options['max_tokens']
            : factoryMaxTokens;
        const maxTurns =
          typeof options['max_turns'] === 'number'
            ? options['max_turns']
            : 10;
        const maxErrors =
          typeof options['max_errors'] === 'number'
            ? options['max_errors']
            : 3;
        const initialMessages =
          Array.isArray(options['messages']) && options['messages'].length > 0
            ? (options['messages'] as Array<Record<string, unknown>>)
            : [];

        // Build initial Gemini contents array
        const contents: Content[] = [];

        // Add history messages if provided
        for (const msg of initialMessages) {
          if (
            typeof msg === 'object' &&
            msg !== null &&
            'role' in msg &&
            'content' in msg
          ) {
            const role = msg['role'];
            if (role === 'user') {
              contents.push({
                role: 'user',
                parts: [{ text: msg['content'] as string }],
              });
            } else if (role === 'assistant') {
              contents.push({
                role: 'model',
                parts: [{ text: msg['content'] as string }],
              });
            }
          }
        }

        // Add user prompt
        contents.push({
          role: 'user',
          parts: [{ text: prompt }],
        });

        // Build Gemini API config
        const apiConfig = {
          ...(system !== undefined && { systemInstruction: system }),
          ...(maxTokens !== undefined && { maxOutputTokens: maxTokens }),
          ...(factoryTemperature !== undefined && {
            temperature: factoryTemperature,
          }),
        };

        // Define Gemini-specific callbacks for shared tool loop
        const buildToolDeclarations = (
          toolDefs: Array<{
            name: string;
            description: string;
            input_schema: {
              type: 'object';
              properties: Record<string, unknown>;
              required: string[];
            };
          }>
        ): FunctionDeclaration[] => {
          return toolDefs.map((def) => {
            // Convert JSON Schema properties to Gemini Schema format
            const properties: Record<string, Schema> = {};
            for (const [propName, propDef] of Object.entries(
              def.input_schema.properties
            )) {
              const prop = propDef as Record<string, unknown>;
              const propType = prop['type'] as string;

              // Map JSON Schema types to Gemini Schema types
              let schemaType = Type.STRING;
              if (propType === 'number') schemaType = Type.NUMBER;
              if (propType === 'boolean') schemaType = Type.BOOLEAN;
              if (propType === 'integer') schemaType = Type.INTEGER;
              if (propType === 'array') schemaType = Type.ARRAY;
              if (propType === 'object') schemaType = Type.OBJECT;

              properties[propName] = {
                type: schemaType,
                description: (prop['description'] as string) ?? '',
              };
            }

            return {
              name: def.name,
              description: def.description,
              parameters: {
                type: Type.OBJECT,
                properties,
                required: def.input_schema.required,
              },
            };
          });
        };

        // Run executeToolLoop with yieldChunk. The generator and the tool loop
        // communicate via a queue + signal: chunks are buffered in the queue
        // so early yieldChunk calls are not dropped when the generator is not
        // yet waiting. The generator drains the queue on each wake.
        let resolveNext: (() => void) | undefined;
        const chunkQueue: RillValue[] = [];
        let streamDone = false;
        let streamError: RuntimeError | RuntimeHaltSignal | undefined;
        let loopResultHolder: { response: unknown; totalTokens: { input: number; output: number }; turns: number } | undefined;
        // AC-16: Accumulate text deltas so resolve() can return partial content on disconnect
        const accumulatedTextDeltas: string[] = [];

        const callbacks: ToolLoopCallbacks = {
          buildTools: buildToolDeclarations,

          callAPI: async (
            msgs: unknown[],
            tools: unknown,
            signal?: AbortSignal
          ): Promise<unknown> => {
            return await client.models.generateContent({
              model: factoryModel,
              contents: msgs as Content[],
              config: {
                ...apiConfig,
                ...(signal !== undefined && { abortSignal: signal }),
                tools: [
                  { functionDeclarations: tools as FunctionDeclaration[] },
                ],
              },
            });
          },

          // IR-3: Streaming API path
          callAPIStreaming: async (
            msgs: unknown[],
            tools: unknown,
            onTextDelta: (text: string) => void,
            signal?: AbortSignal
          ): Promise<unknown> => {
            const stream = await client.models.generateContentStream({
              model: factoryModel,
              contents: msgs as Content[],
              config: {
                ...apiConfig,
                ...(signal !== undefined && { abortSignal: signal }),
                tools: [
                  { functionDeclarations: tools as FunctionDeclaration[] },
                ],
              },
            });

            let lastChunk: unknown;
            for await (const chunk of stream) {
              lastChunk = chunk;
              const delta = (chunk as { text?: string }).text ?? '';
              if (delta) {
                onTextDelta(delta);
              }
            }

            return lastChunk;
          },

          extractToolCalls: (
            response: unknown
          ): Array<{ id: string; name: string; input: object }> | null => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('functionCalls' in response)
            ) {
              return null;
            }

            const functionCalls = (response as { functionCalls?: unknown[] })
              .functionCalls;
            if (!functionCalls || functionCalls.length === 0) {
              return null;
            }

            return functionCalls.map((fc) => {
              const call = fc as {
                id?: string;
                name?: string;
                args?: object;
              };
              return {
                id: call.id ?? '',
                name: call.name ?? '',
                input: call.args ?? {},
              };
            });
          },

          formatAssistantMessage: (response: unknown): unknown => {
            if (
              !response ||
              typeof response !== 'object' ||
              !('candidates' in response)
            ) {
              return null;
            }

            const candidates = (response as { candidates?: unknown[] })
              .candidates;
            if (!Array.isArray(candidates) || candidates.length === 0) {
              return null;
            }

            const candidate = candidates[0];
            if (
              !candidate ||
              typeof candidate !== 'object' ||
              !('content' in candidate)
            ) {
              return null;
            }

            return (candidate as { content: unknown }).content;
          },

          formatToolResult: (
            toolResults: Array<{
              id: string;
              name: string;
              result: RillValue;
              error?: string;
            }>
          ): unknown => {
            const functionResponseParts: Part[] = toolResults.map((tr) => ({
              functionResponse: {
                name: tr.name,
                response: {
                  result: tr.error
                    ? `Error: ${tr.error}`
                    : typeof tr.result === 'string'
                      ? tr.result
                      : JSON.stringify(tr.result),
                },
              },
            }));

            return {
              role: 'user' as const,
              parts: functionResponseParts,
            };
          },
        };

        const toolLoopAbortController = new AbortController();

        // Run executeToolLoop as a background Promise; chunks are collected via yieldChunk
        const loopPromise = executeToolLoop(
          contents,
          toolsDict,
          maxErrors,
          callbacks,
          (event: string, data: Record<string, unknown>) => {
            const eventMap: Record<string, string> = {
              tool_call: 'gemini:tool_call',
              tool_result: 'gemini:tool_result',
            };

            emitExtensionEvent(ctx as RuntimeContext, {
              event: eventMap[event] || event,
              subsystem: 'extension:gemini',
              ...data,
            });
          },
          maxTurns,
          ctx,
          // yieldChunk — called from executeToolLoop for each text_delta, tool_call,
          // or tool_result. Buffers the chunk and signals the generator to wake.
          // AC-16: Also accumulate text_delta text for partial resolve on disconnect.
          (chunk: RillValue) => {
            const chunkRecord = chunk as Record<string, unknown>;
            if (chunkRecord['type'] === 'text_delta' && typeof chunkRecord['text'] === 'string') {
              accumulatedTextDeltas.push(chunkRecord['text'] as string);
            }
            chunkQueue.push(chunk);
            if (resolveNext) {
              const r = resolveNext;
              resolveNext = undefined;
              r();
            }
          },
          toolLoopAbortController.signal
        ).then((result) => {
          loopResultHolder = result;
          streamDone = true;
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = undefined;
            r();
          }
        }).catch((error: unknown) => {
          streamError =
            error instanceof RuntimeError || error instanceof RuntimeHaltSignal
              ? error
              : mapToHalt(ctx as RuntimeContext, error);
          streamDone = true;
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = undefined;
            r();
          }
        });

        // Async generator that drains chunkQueue, then waits for more chunks.
        // Chunks buffered before the generator starts are not dropped.
        async function* streamGenerator(): AsyncGenerator<RillValue> {
          while (true) {
            // Drain all queued chunks first
            while (chunkQueue.length > 0) {
              yield chunkQueue.shift()!;
            }
            // If loop is done, check for error and exit
            if (streamDone) {
              if (streamError) throw streamError;
              break;
            }
            // Wait for the next yieldChunk signal or loop completion
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }
        }

        const inputMessages = [
          ...initialMessages.map((m) => ({
            role: m['role'] as string,
            content: (m['content'] as string) ?? '',
          })),
          { role: 'user', content: prompt },
        ];

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

        // Resolve callback — called after chunk exhaustion to return the final dict
        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          // Ensure the loop promise has settled
          await loopPromise;

          if (streamError) {
            // AC-16: When text was accumulated before the disconnect, return partial dict.
            // This brings Gemini in line with Anthropic and OpenAI AC-16 behavior.
            // When no text was accumulated (e.g. pure API failure at start), rethrow so
            // callers receive the RILL-R005 error (EC-4/EC-12 behavior preserved).
            if (accumulatedTextDeltas.length > 0) {
              const partialContent = accumulatedTextDeltas.join('');
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'gemini:error',
                subsystem: 'extension:gemini',
                error: streamErrorMessage(streamError),
                duration: Date.now(),
              });
              return {
                content: partialContent,
                model: factoryModel,
                usage: { input: 0, output: 0 },
                stop_reason: 'error',
                turns: 0,
                messages: buildResponseMessages(inputMessages, partialContent),
              } as RillValue;
            }
            // EC-12: No text accumulated — provider failure before any content
            const duration = Date.now();
            emitExtensionEvent(ctx as RuntimeContext, {
              event: 'gemini:error',
              subsystem: 'extension:gemini',
              error: streamErrorMessage(streamError),
              duration,
            });
            throw streamError;
          }

          const result = loopResultHolder!;
          const response = result.response;
          const content =
            response && typeof response === 'object' && 'text' in response
              ? ((response as { text?: string }).text ?? '')
              : '';

          const resolvedResult = {
            content,
            model: factoryModel,
            usage: result.totalTokens,
            stop_reason: response ? 'stop' : 'max_turns',
            turns: result.turns,
            messages: response
              ? buildResponseMessages(inputMessages, content)
              : inputMessages,
          };

          // Emit tool_loop event
          const total_duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:tool_loop',
            subsystem: 'extension:gemini',
            turns: resolvedResult.turns,
            total_duration,
            usage: resolvedResult.usage,
            request: contents,
            content,
          });

          return resolvedResult as RillValue;
        };

        return createRillStream({
          chunks: streamGenerator(),
          resolve,
          dispose: () => { toolLoopAbortController.abort(); },
          chunkType: { kind: 'dict' },
          retType: retTypeStructure,
        }) as RillValue;
      },
      annotations: { description: 'Execute tool-use loop with Gemini API' },
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

    // IR-3: gemini::generate
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

          // Convert JSON Schema properties to Gemini Schema type (IR-6)
          const geminiProperties: Record<string, Schema> = {};
          for (const [key, prop] of Object.entries(jsonSchema.properties)) {
            geminiProperties[key] = toGeminiSchema(prop);
          }
          const responseSchema: Schema = {
            type: Type.OBJECT,
            properties: geminiProperties,
            required: jsonSchema.required,
          };

          // Extract options
          const system =
            typeof options['system'] === 'string'
              ? options['system']
              : factorySystem;
          const maxTokens =
            typeof options['max_tokens'] === 'number' && options['max_tokens'] > 0
              ? options['max_tokens']
              : factoryMaxTokens;

          // Build Gemini contents array: prepend context messages then prompt
          const contents: Content[] = [];

          if ('messages' in options && Array.isArray(options['messages'])) {
            const prependedMessages = options['messages'] as Array<
              Record<string, unknown>
            >;

            for (const msg of prependedMessages) {
              if (
                typeof msg === 'object' &&
                msg !== null &&
                'role' in msg &&
                'content' in msg
              ) {
                const role = msg['role'];
                if (role === 'user') {
                  contents.push({
                    role: 'user',
                    parts: [{ text: msg['content'] as string }],
                  });
                } else if (role === 'assistant') {
                  contents.push({
                    role: 'model',
                    parts: [{ text: msg['content'] as string }],
                  });
                }
              }
            }
          }

          // Add the prompt as the final user turn
          contents.push({
            role: 'user',
            parts: [{ text: prompt }],
          });

          // Build API config with responseSchema and responseMimeType (IR-6)
          const apiConfig: {
            systemInstruction?: string;
            maxOutputTokens?: number;
            temperature?: number;
            responseSchema: Schema;
            responseMimeType: string;
          } = {
            responseSchema,
            responseMimeType: 'application/json',
          };

          if (system !== undefined) {
            apiConfig.systemInstruction = system;
          }
          if (maxTokens !== undefined) {
            apiConfig.maxOutputTokens = maxTokens;
          }
          if (factoryTemperature !== undefined) {
            apiConfig.temperature = factoryTemperature;
          }

          // Call Gemini API
          const response = await client.models.generateContent({
            model: factoryModel,
            contents,
            config: apiConfig,
          });

          // Extract JSON string from response.text (IR-6)
          const raw = response.text ?? '';

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

          // Extract usage metadata (IR-6)
          const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens =
            response.usageMetadata?.candidatesTokenCount ?? 0;

          // Extract stop reason and id (IR-6)
          const stopReason = response.candidates?.[0]?.finishReason ?? 'stop';
          const id = response.responseId ?? '';

          // Build 6-key response dict (AC-6, AC-7)
          const generateResult = {
            data,
            raw,
            model: factoryModel,
            usage: {
              input: inputTokens,
              output: outputTokens,
            },
            stop_reason: stopReason,
            id,
          };

          // Emit success event (AC-34)
          const duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:generate',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: generateResult.usage,
            request: contents,
            content: raw,
          });

          return generateResult as RillValue;
        } catch (error: unknown) {
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal =
            error instanceof RuntimeError
              ? error
              : mapToHalt(ctx as RuntimeContext, error);

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:error',
            subsystem: 'extension:gemini',
            error: streamErrorMessage(rillError),
            duration,
          });

          throw rillError;
        }
      },
      annotations: { description: 'Generate structured output from Gemini API' },
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
