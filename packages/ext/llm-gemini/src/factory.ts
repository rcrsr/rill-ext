/**
 * Extension factory for Gemini API integration.
 * Creates extension instance with config validation and SDK lifecycle management.
 */

import {
  GoogleGenAI,
  Type,
  type FunctionDeclaration,
  type Content,
  type Part as GeminiPart,
  type Schema,
  type GoogleGenAIOptions,
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
  normalizePrompt,
  RESERVED_KEYS_COMMON,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
  MESSAGE_DICT_STRUCTURE,
  type JsonSchemaProperty,
  type ProviderErrorDetector,
  type ToolLoopCallbacks,
  type Message,
  type Part,
} from '@rcrsr/rill-ext-llm-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { GeminiExtensionConfig } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_MAX_TOKENS = 8192;

/** Gemini-specific reserved keys — superset of RESERVED_KEYS_COMMON. */
const RESERVED_KEYS_GEMINI = [
  ...RESERVED_KEYS_COMMON,
  'contents',
  'systemInstruction',
] as const;

// ============================================================
// RETURN TYPE CONSTANTS
// ============================================================

/**
 * Shared inner structure for the messages list field across all verbs.
 * Uses MESSAGE_DICT_STRUCTURE from ext-llm-shared, which carries the full
 * PARTS_LIST_STRUCTURE for the `parts` field (rich superset shape per §EXT.8.1).
 */
const MESSAGES_FIELD_STRUCTURE = {
  kind: 'list' as const,
  element: MESSAGE_DICT_STRUCTURE,
};

/**
 * Shared inner structure for the usage dict field across all verbs.
 */
const USAGE_FIELD_STRUCTURE = {
  kind: 'dict' as const,
  fields: {
    input: { type: { kind: 'number' as const } },
    output: { type: { kind: 'number' as const } },
  },
};

/**
 * Common ret-dict TypeStructure for message and tool_loop verbs.
 * Used both for RillFunction.returnType (via structureToTypeValue) and
 * for createRillStream.retType (raw TypeStructure).
 */
const MESSAGE_RET_STRUCTURE = {
  kind: 'dict' as const,
  fields: {
    messages: { type: MESSAGES_FIELD_STRUCTURE },
    model: { type: { kind: 'string' as const } },
    usage: { type: USAGE_FIELD_STRUCTURE },
    stop_reason: { type: { kind: 'string' as const } },
    id: { type: { kind: 'string' as const } },
  },
};

const MESSAGE_VERB_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'string' },
  ret: MESSAGE_RET_STRUCTURE,
});

const TOOL_LOOP_VERB_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'dict' },
  ret: MESSAGE_RET_STRUCTURE,
});

const GENERATE_VERB_RETURN_TYPE = structureToTypeValue({
  kind: 'dict',
  fields: {
    data: { type: { kind: 'any' } },
    raw: { type: { kind: 'string' } },
    messages: { type: MESSAGES_FIELD_STRUCTURE },
    model: { type: { kind: 'string' } },
    usage: { type: USAGE_FIELD_STRUCTURE },
    stop_reason: { type: { kind: 'string' } },
    id: { type: { kind: 'string' } },
  },
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Map a non-RuntimeError into an invalid RillValue + halt signal pair so
 * factory call sites can capture the halt for later re-throw while still
 * emitting events with the human-readable message.
 */
function mapToHalt(ctx: RuntimeContext, error: unknown): RuntimeHaltSignal {
  const invalid = mapProviderError(ctx, 'Gemini', error, detectGeminiError);
  return new RuntimeHaltSignal(invalid, true);
}

/**
 * Build an invalid-RillValue halt signal carrying a generic atom.
 * Host scripts recover via `guard #<ATOM>`.
 */
function haltInvalid(
  ctx: RuntimeContext,
  code: string,
  rawKind: string,
  message: string
): RuntimeHaltSignal {
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code,
      provider: 'gemini',
      raw: { kind: rawKind, message },
    }),
    true
  );
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
// WIRE TRANSLATORS
// ============================================================

/**
 * Convert a JsonSchemaProperty (string type names) to a Gemini Schema
 * (Type enum values). Mirrors the type-mapping pattern in buildTools.
 */
function toGeminiSchema(prop: JsonSchemaProperty): Schema {
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

/**
 * Convert a canonical Part to a Gemini Part.
 *
 * Per-Part single-field rule: a Gemini Part may carry ONLY ONE of
 * text / inlineData / fileData / functionCall / functionResponse.
 * Do not populate multiple fields on a single Part object.
 */
function canonicalPartToGemini(part: Part): GeminiPart {
  switch (part.type) {
    case 'text':
    case 'thinking':
      // Both map to text on the wire
      return { text: part.text };

    case 'image': {
      const src = part.source;
      if (src.kind === 'base64') {
        // Canonical base64 image → Gemini inlineData
        return {
          inlineData: {
            mimeType: src.media_type,
            data: src.data,
          },
        };
      }
      // Canonical url image → Gemini fileData
      return {
        fileData: {
          fileUri: src.data,
          mimeType: src.media_type,
        },
      };
    }

    case 'tool_use':
      // Canonical tool_use → Gemini functionCall
      return {
        functionCall: {
          name: part.name,
          args: part.input as Record<string, unknown>,
        },
      };

    case 'tool_result': {
      // Canonical tool_result → Gemini functionResponse
      // Collapse nested parts to a text string for the response body
      const responseText = part.parts
        .map((p) =>
          p.type === 'text' || p.type === 'thinking'
            ? p.text
            : JSON.stringify(p)
        )
        .join('');
      return {
        functionResponse: {
          name: part.name ?? part.id,
          response: { result: responseText },
        },
      };
    }
  }
}

/**
 * Convert canonical Message[] to Gemini Content[].
 *
 * Rules:
 * - canonical `system` role is lifted to top-level `systemInstruction` and
 *   NOT added to the contents array.
 * - canonical `assistant` role maps to Gemini `model` role.
 * - canonical `user` role stays `user`.
 */
function canonicalToGeminiContents(messages: Message[]): {
  contents: Content[];
  systemInstruction: string | undefined;
} {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Lift system turn to systemInstruction; use text from first text part
      const textPart = msg.parts.find(
        (p) => p.type === 'text' || p.type === 'thinking'
      );
      if (
        textPart &&
        (textPart.type === 'text' || textPart.type === 'thinking')
      ) {
        systemInstruction = textPart.text;
      }
      continue;
    }

    const geminiRole: 'user' | 'model' =
      msg.role === 'assistant' ? 'model' : 'user';
    const geminiParts = msg.parts.map(canonicalPartToGemini);

    contents.push({ role: geminiRole, parts: geminiParts });
  }

  return { contents, systemInstruction };
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Build the `httpOptions` object for the GoogleGenAI client from
 * `base_url`, `timeout`, and `max_retries` config fields, omitting any
 * fields that are undefined. Returns `undefined` when none are set so
 * callers do not attach an empty `httpOptions` object.
 *
 * `max_retries` maps to `retryOptions.attempts`, which counts the original
 * request plus retries (attempts = max_retries + 1).
 */
function buildHttpOptions(
  config: GeminiExtensionConfig
): GoogleGenAIOptions['httpOptions'] {
  const httpOptions: NonNullable<GoogleGenAIOptions['httpOptions']> = {};

  if (config.base_url !== undefined) {
    httpOptions.baseUrl = config.base_url;
  }
  if (config.timeout !== undefined) {
    httpOptions.timeout = config.timeout;
  }
  if (config.max_retries !== undefined) {
    httpOptions.retryOptions = { attempts: config.max_retries + 1 };
  }

  return Object.keys(httpOptions).length > 0 ? httpOptions : undefined;
}

/**
 * Resolve the GoogleGenAI client options for the configured auth mode.
 *
 * Three mutually exclusive modes:
 * 1. Gemini Developer (default, !config.vertexai): apiKey-based auth against
 *    the public Gemini API.
 * 2. Vertex Express (config.vertexai === true && config.api_key !== undefined):
 *    apiKey-based auth against Vertex AI.
 * 3. Vertex ADC (config.vertexai === true && config.api_key === undefined):
 *    project/location-based auth via Application Default Credentials.
 *    project is required in Vertex ADC mode; location is required in Vertex
 *    ADC mode.
 *
 * `base_url`, `timeout`, and `max_retries` are forwarded via `httpOptions`
 * for all three modes when set.
 */
function resolveGoogleGenAIOptions(
  config: GeminiExtensionConfig
): GoogleGenAIOptions {
  const httpOptions = buildHttpOptions(config);

  if (!config.vertexai) {
    // Mode 1: Gemini Developer API (default). Self-contained validation
    // narrows config.api_key to string via the `asserts` return type; the
    // up-front check in createGeminiExtension preserves validation ordering
    // (api_key before model/temperature/etc), this call is redundant but
    // cheap and removes the cross-function invariant.
    validateApiKey(config.api_key);
    return { apiKey: config.api_key, ...(httpOptions && { httpOptions }) };
  }

  if (config.api_key !== undefined) {
    // Mode 2: Vertex Express (apiKey-based auth against Vertex AI)
    validateApiKey(config.api_key);
    return {
      vertexai: true,
      apiKey: config.api_key,
      ...(httpOptions && { httpOptions }),
    };
  }

  // Mode 3: Vertex ADC (project/location-based auth)
  if (!config.project) {
    throw new RuntimeError('RILL-R001', 'project is required for Vertex AI');
  }
  if (!config.location) {
    throw new RuntimeError('RILL-R001', 'location is required for Vertex AI');
  }
  return {
    vertexai: true,
    project: config.project,
    location: config.location,
    ...(httpOptions && { httpOptions }),
  };
}

/**
 * Create Gemini extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with message, embed, embed_batch, tool_loop, generate and dispose
 * @throws RuntimeError for invalid configuration
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
  // Validate api_key first for both the default (Gemini Developer) and
  // Vertex Express auth modes, ahead of model/temperature/etc, so error
  // ordering is mode-independent. Vertex ADC has api_key === undefined and
  // is correctly skipped.
  if (!config.vertexai || config.api_key !== undefined) {
    validateApiKey(config.api_key);
  }

  // Validate required fields
  validateModel(config.model);
  validateTemperature(config.temperature);

  // Validate factory-level max_turns
  validateMaxTurns(config.max_turns);

  // Validate factory-level max_errors; reject 0/negative/non-integer so a
  // misconfigured extension fails fast instead of silently using the default.
  validateMaxErrors(config.max_errors);

  // Validate extra keys against Gemini-specific reserved set
  validateExtraKeys(config.extra, RESERVED_KEYS_GEMINI);

  // Resolve auth mode (Gemini Developer / Vertex Express / Vertex ADC) and
  // instantiate SDK client at factory time
  const client = new GoogleGenAI(resolveGoogleGenAIOptions(config));

  // Extract config values for use in functions
  const factoryModel = config.model;
  const factoryTemperature = config.temperature;
  const factoryMaxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const factorySystem = config.system;
  const factoryEmbedModel = config.embed_model;
  const factoryMaxTurns = config.max_turns;
  const factoryMaxErrors = config.max_errors;
  const factoryExtra = config.extra;

  // AbortController for cancelling pending requests
  let abortController: AbortController | undefined = new AbortController();

  // Dispose function for cleanup
  const dispose = async (): Promise<void> => {
    try {
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
      // Note: Gemini SDK does not expose a close() method
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to cleanup Gemini SDK: ${message}`);
    }
  };

  // After dispose() the abortController is cleared; reject further calls so
  // requests do not proceed on a disposed extension.
  function assertNotDisposed(ctx: RuntimeContext): void {
    if (!abortController) {
      throw haltInvalid(
        ctx,
        'DISPOSED',
        'extension_disposed',
        'gemini: extension disposed'
      );
    }
  }

  /**
   * Build the generationConfig object, merging factory extra.
   * Validated extra fields merge into generationConfig per Gemini SDK shape.
   */
  function buildGenerationConfig(overrides: {
    systemInstruction?: string | undefined;
    maxOutputTokens?: number | undefined;
    temperature?: number | undefined;
    responseSchema?: Schema | undefined;
    responseMimeType?: string | undefined;
  }): Record<string, unknown> {
    const base: Record<string, unknown> = {};

    if (overrides.systemInstruction !== undefined) {
      base['systemInstruction'] = overrides.systemInstruction;
    }
    if (overrides.maxOutputTokens !== undefined) {
      base['maxOutputTokens'] = overrides.maxOutputTokens;
    }
    if (overrides.temperature !== undefined) {
      base['temperature'] = overrides.temperature;
    }
    if (overrides.responseSchema !== undefined) {
      base['responseSchema'] = overrides.responseSchema;
    }
    if (overrides.responseMimeType !== undefined) {
      base['responseMimeType'] = overrides.responseMimeType;
    }

    // Merge factory extra into generationConfig (after reserved keys are validated)
    if (factoryExtra !== undefined) {
      for (const [k, v] of Object.entries(factoryExtra)) {
        base[k] = v;
      }
    }

    return base;
  }

  // Return extension result with implementations — satisfies verifies contract at compile time
  const fnDict: {
    message: RillFunction;
    embed: RillFunction;
    embed_batch: RillFunction;
    tool_loop: RillFunction;
    generate: RillFunction;
  } = {
    // gemini::message — single or multi-turn via prompt param (string OR list)
    message: {
      params: [
        {
          name: 'prompt',
          type: { kind: 'any' },
          defaultValue: undefined,
          annotations: { description: 'String or list of message dicts' },
        },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;

        // Normalize prompt to canonical Message[]
        const normalized = normalizePrompt(rawPrompt, ctx as RuntimeContext);

        // If normalizePrompt returned an invalid RillValue, surface it
        if (!Array.isArray(normalized)) {
          return normalized;
        }

        const inputMessages = normalized as Message[];

        // Translate canonical messages to Gemini wire format
        const { contents, systemInstruction: msgSystemInstruction } =
          canonicalToGeminiContents(inputMessages);

        // Prefer message-level system instruction, then factory-level
        const resolvedSystem = msgSystemInstruction ?? factorySystem;

        const apiConfig = buildGenerationConfig({
          systemInstruction: resolvedSystem,
          maxOutputTokens: factoryMaxTokens,
          temperature: factoryTemperature,
        });

        // Accumulate streamed text deltas for resolve
        const collectedChunks: string[] = [];
        let streamError: RuntimeError | RuntimeHaltSignal | undefined;

        const streamAbortController = new AbortController();
        const messageStartTime = Date.now();

        async function* streamChunks(): AsyncGenerator<RillValue> {
          try {
            const stream = await client.models.generateContentStream({
              model: factoryModel,
              contents,
              config: {
                ...apiConfig,
                abortSignal: AbortSignal.any([
                  abortController!.signal,
                  streamAbortController.signal,
                ]),
              },
            });
            for await (const chunk of stream) {
              const delta = chunk.text ?? '';
              if (delta) {
                collectedChunks.push(delta);
                yield delta as RillValue;
              }
            }
          } catch (error: unknown) {
            streamError =
              error instanceof RuntimeError ||
              error instanceof RuntimeHaltSignal
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

        const resolve = async (): Promise<RillValue> => {
          if (streamError) {
            throw streamError;
          }
          const duration = Date.now() - messageStartTime;
          const textContent = collectedChunks.join('');

          // Build parts-shaped assistant reply
          const assistantParts: Part[] = [{ type: 'text', text: textContent }];
          const messages = buildResponseMessages(
            inputMessages,
            assistantParts
          ) as unknown as RillValue;

          const result = {
            messages,
            model: factoryModel,
            usage: { input: 0, output: 0 },
            stop_reason: 'stop',
            id: '',
          };

          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:message',
            subsystem: 'extension:gemini',
            duration,
            model: factoryModel,
            usage: result.usage,
            request: contents,
            content: textContent,
          });

          return result as RillValue;
        };

        return createRillStream({
          chunks: streamChunks(),
          resolve,
          dispose: () => {
            streamAbortController.abort();
          },
          chunkType: { kind: 'string' },
          retType: MESSAGE_RET_STRUCTURE,
        }) as RillValue;
      },
      annotations: {
        description: 'Send single or multi-turn message to Gemini API',
      },
      returnType: MESSAGE_VERB_RETURN_TYPE,
    },

    // gemini::embed
    embed: {
      params: [p.str('text')],
      fn: async (args, ctx): Promise<RillValue> => {
        assertNotDisposed(ctx as RuntimeContext);
        const startTime = Date.now();

        try {
          const text = args['text'] as string;

          validateEmbedText(text);
          validateEmbedModel(factoryEmbedModel);

          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: [text],
            config: { abortSignal: abortController!.signal },
          });

          const embedding = response.embeddings?.[0];
          if (
            !embedding ||
            !embedding.values ||
            embedding.values.length === 0
          ) {
            throw haltInvalid(
              ctx as RuntimeContext,
              'PROTOCOL',
              'empty_embedding_response',
              'Gemini: empty embedding returned'
            );
          }

          const float32Data = new Float32Array(embedding.values);
          const vector = createVector(float32Data, factoryEmbedModel);

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
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal =
            error instanceof RuntimeError || error instanceof RuntimeHaltSignal
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

    // gemini::embed_batch
    embed_batch: {
      params: [p.list('texts')],
      fn: async (args, ctx): Promise<RillValue> => {
        assertNotDisposed(ctx as RuntimeContext);
        const startTime = Date.now();

        try {
          const texts = args['texts'] as Array<RillValue>;

          if (texts.length === 0) {
            return [] as RillValue;
          }

          validateEmbedModel(factoryEmbedModel);
          const stringTexts = validateEmbedBatch(texts);

          const response = await client.models.embedContent({
            model: factoryEmbedModel,
            contents: stringTexts,
            config: { abortSignal: abortController!.signal },
          });

          const vectors: RillValue[] = [];
          if (!response.embeddings || response.embeddings.length === 0) {
            throw haltInvalid(
              ctx as RuntimeContext,
              'PROTOCOL',
              'empty_embeddings_response',
              'Gemini: empty embeddings returned'
            );
          }

          for (const embedding of response.embeddings) {
            if (
              !embedding ||
              !embedding.values ||
              embedding.values.length === 0
            ) {
              throw haltInvalid(
                ctx as RuntimeContext,
                'PROTOCOL',
                'empty_embedding_response',
                'Gemini: empty embedding returned'
              );
            }
            const float32Data = new Float32Array(embedding.values);
            const vector = createVector(float32Data, factoryEmbedModel);
            vectors.push(vector as RillValue);
          }

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
          const duration = Date.now() - startTime;
          const rillError: RuntimeError | RuntimeHaltSignal =
            error instanceof RuntimeError || error instanceof RuntimeHaltSignal
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
      annotations: {
        description: 'Generate embedding vectors for multiple texts',
      },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'vector' },
      }),
    },

    // gemini::tool_loop — multi-turn tool calling
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
        assertNotDisposed(ctx as RuntimeContext);
        const rawPrompt = args['prompt'] as RillValue;
        const toolsDict = args['tools'] as RillValue;
        const perCallMaxTurns = (args['max_turns'] as number) ?? 0;

        // Negative per-call max_turns → INVALID_INPUT
        if (perCallMaxTurns < 0) {
          throw haltInvalid(
            ctx as RuntimeContext,
            'INVALID_INPUT',
            'invalid_max_turns',
            'max_turns must be >= 0'
          );
        }

        // Empty tools dict → INVALID_INPUT
        if (
          toolsDict !== undefined &&
          typeof toolsDict === 'object' &&
          toolsDict !== null &&
          !Array.isArray(toolsDict) &&
          Object.keys(toolsDict as Record<string, unknown>).length === 0
        ) {
          throw haltInvalid(
            ctx as RuntimeContext,
            'INVALID_INPUT',
            'empty_tools_dict',
            'tool_loop: tools dict cannot be empty'
          );
        }

        // Normalize prompt to canonical Message[]
        const normalized = normalizePrompt(rawPrompt, ctx as RuntimeContext);
        if (!Array.isArray(normalized)) {
          // Return the invalid RillValue — caller will see it as an error
          return normalized;
        }

        const inputMessages = normalized as Message[];

        // Translate canonical messages to Gemini wire format
        const { contents, systemInstruction: msgSystemInstruction } =
          canonicalToGeminiContents(inputMessages);

        // Prefer message-level system instruction, then factory-level
        const resolvedSystem = msgSystemInstruction ?? factorySystem;

        const apiConfig = buildGenerationConfig({
          systemInstruction: resolvedSystem,
          maxOutputTokens: factoryMaxTokens,
          temperature: factoryTemperature,
        });

        const maxErrors = factoryMaxErrors ?? 3;

        // Build Gemini-specific tool declarations from shared schema descriptors
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
            const properties: Record<string, Schema> = {};
            for (const [propName, propDef] of Object.entries(
              def.input_schema.properties
            )) {
              const prop = propDef as Record<string, unknown>;
              const propType = prop['type'] as string;

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

        let resolveNext: (() => void) | undefined;
        const chunkQueue: RillValue[] = [];
        let streamDone = false;
        let streamError: RuntimeError | RuntimeHaltSignal | undefined;
        let loopResultHolder:
          | {
              response: unknown;
              totalTokens: { input: number; output: number };
              turns: number;
            }
          | undefined;
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
            // Each functionResponse must be its own Part (single-field rule)
            const functionResponseParts: GeminiPart[] = toolResults.map(
              (tr) => ({
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
              })
            );

            return {
              role: 'user' as const,
              parts: functionResponseParts,
            };
          },
        };

        const toolLoopAbortController = new AbortController();

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
          perCallMaxTurns,
          ctx,
          (chunk: RillValue) => {
            const chunkRecord = chunk as Record<string, unknown>;
            if (
              chunkRecord['type'] === 'text_delta' &&
              typeof chunkRecord['text'] === 'string'
            ) {
              accumulatedTextDeltas.push(chunkRecord['text'] as string);
            }
            chunkQueue.push(chunk);
            if (resolveNext) {
              const r = resolveNext;
              resolveNext = undefined;
              r();
            }
          },
          AbortSignal.any([
            abortController!.signal,
            toolLoopAbortController.signal,
          ]),
          factoryMaxTurns
        )
          .then((result) => {
            loopResultHolder = result;
            streamDone = true;
            if (resolveNext) {
              const r = resolveNext;
              resolveNext = undefined;
              r();
            }
          })
          .catch((error: unknown) => {
            streamError =
              error instanceof RuntimeError ||
              error instanceof RuntimeHaltSignal
                ? error
                : mapToHalt(ctx as RuntimeContext, error);
            streamDone = true;
            if (resolveNext) {
              const r = resolveNext;
              resolveNext = undefined;
              r();
            }
          });

        async function* streamGenerator(): AsyncGenerator<RillValue> {
          while (true) {
            while (chunkQueue.length > 0) {
              yield chunkQueue.shift()!;
            }
            if (streamDone) {
              if (streamError) throw streamError;
              break;
            }
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }
        }

        const resolve = async (): Promise<RillValue> => {
          const startTime = Date.now();
          await loopPromise;

          if (streamError) {
            if (accumulatedTextDeltas.length > 0) {
              const partialContent = accumulatedTextDeltas.join('');
              emitExtensionEvent(ctx as RuntimeContext, {
                event: 'gemini:error',
                subsystem: 'extension:gemini',
                error: streamErrorMessage(streamError),
                duration: Date.now(),
              });
              const assistantParts: Part[] = [
                { type: 'text', text: partialContent },
              ];
              return {
                messages: buildResponseMessages(
                  inputMessages,
                  assistantParts
                ) as unknown as RillValue,
                model: factoryModel,
                usage: { input: 0, output: 0 },
                stop_reason: 'error',
                id: '',
              } as RillValue;
            }
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
          const textContent =
            response && typeof response === 'object' && 'text' in response
              ? ((response as { text?: string }).text ?? '')
              : '';

          // Build parts-shaped assistant reply
          const assistantParts: Part[] = [{ type: 'text', text: textContent }];
          const messages = response
            ? (buildResponseMessages(
                inputMessages,
                assistantParts
              ) as unknown as RillValue)
            : (inputMessages as unknown as RillValue);

          const resolvedResult = {
            messages,
            model: factoryModel,
            usage: result.totalTokens,
            stop_reason: response ? 'stop' : 'max_turns',
            id: '',
          };

          const total_duration = Date.now() - startTime;
          emitExtensionEvent(ctx as RuntimeContext, {
            event: 'gemini:tool_loop',
            subsystem: 'extension:gemini',
            turns: result.turns,
            total_duration,
            usage: resolvedResult.usage,
            request: contents,
            content: textContent,
          });

          return resolvedResult as RillValue;
        };

        return createRillStream({
          chunks: streamGenerator(),
          resolve,
          dispose: () => {
            toolLoopAbortController.abort();
          },
          chunkType: { kind: 'dict' },
          retType: MESSAGE_RET_STRUCTURE,
        }) as RillValue;
      },
      annotations: { description: 'Execute tool-use loop with Gemini API' },
      returnType: TOOL_LOOP_VERB_RETURN_TYPE,
    },

    // gemini::generate — structured output
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
          type: { kind: 'type' } as { kind: string },
          defaultValue: undefined,
          annotations: {
            description: 'Type expression for structured output schema',
          },
        },
      ],
      fn: async (args, ctx): Promise<RillValue> => {
        assertNotDisposed(ctx as RuntimeContext);
        const startTime = Date.now();

        try {
          const rawPrompt = args['prompt'] as RillValue;
          const schemaArg = args['schema'] as
            | { __rill_type?: boolean; structure?: TypeStructure }
            | undefined;

          // Validate schema is a type value with dict structure
          if (!schemaArg || !schemaArg.__rill_type || !schemaArg.structure) {
            throw haltInvalid(
              ctx as RuntimeContext,
              'INVALID_INPUT',
              'invalid_schema',
              'generate requires a type expression as schema'
            );
          }
          if (schemaArg.structure.kind !== 'dict') {
            throw haltInvalid(
              ctx as RuntimeContext,
              'INVALID_INPUT',
              'invalid_schema_type',
              `generate requires a dict type as schema, got ${schemaArg.structure.kind}`
            );
          }

          // Normalize prompt to canonical Message[]
          const normalized = normalizePrompt(rawPrompt, ctx as RuntimeContext);
          if (!Array.isArray(normalized)) {
            return normalized;
          }
          const inputMessages = normalized as Message[];

          // Build JSON Schema from TypeStructure
          const jsonSchema = buildJsonSchemaFromStructuralType(
            schemaArg.structure
          );

          // Convert JSON Schema properties to Gemini Schema type
          const geminiProperties: Record<string, Schema> = {};
          for (const [key, prop] of Object.entries(jsonSchema.properties)) {
            geminiProperties[key] = toGeminiSchema(prop);
          }
          const responseSchema: Schema = {
            type: Type.OBJECT,
            properties: geminiProperties,
            required: jsonSchema.required,
          };

          // Translate canonical messages to Gemini wire format
          const { contents, systemInstruction: msgSystemInstruction } =
            canonicalToGeminiContents(inputMessages);

          const resolvedSystem = msgSystemInstruction ?? factorySystem;

          const apiConfig = buildGenerationConfig({
            systemInstruction: resolvedSystem,
            maxOutputTokens: factoryMaxTokens,
            temperature: factoryTemperature,
            responseSchema,
            responseMimeType: 'application/json',
          });

          // generate must not use streaming — non-streaming path only
          const response = await client.models.generateContent({
            model: factoryModel,
            contents,
            config: { ...apiConfig, abortSignal: abortController!.signal },
          });

          // Reject streaming response shape
          if (!('text' in response) && !('candidates' in response)) {
            throw haltInvalid(
              ctx as RuntimeContext,
              'PROTOCOL',
              'unexpected_response_format',
              'generate: unexpected response format from Gemini API'
            );
          }

          const raw = response.text ?? '';

          // Parse JSON; throw on failure with PROTOCOL / schema_validation_failed
          let data: unknown;
          try {
            data = JSON.parse(raw) as unknown;
          } catch (parseError: unknown) {
            const detail =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            throw haltInvalid(
              ctx as RuntimeContext,
              'PROTOCOL',
              'schema_validation_failed',
              `generate: failed to parse response JSON: ${detail}`
            );
          }

          const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens =
            response.usageMetadata?.candidatesTokenCount ?? 0;

          const stopReason = response.candidates?.[0]?.finishReason ?? 'stop';
          const id = response.responseId ?? '';

          // Build parts-shaped messages: input + assistant reply containing raw JSON
          const assistantParts: Part[] = [{ type: 'text', text: raw }];
          const messages = buildResponseMessages(
            inputMessages,
            assistantParts
          ) as unknown as RillValue;

          const generateResult = {
            data,
            raw,
            messages,
            model: factoryModel,
            usage: {
              input: inputTokens,
              output: outputTokens,
            },
            stop_reason: stopReason,
            id,
          };

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
            error instanceof RuntimeError || error instanceof RuntimeHaltSignal
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
      annotations: {
        description: 'Generate structured output from Gemini API',
      },
      returnType: GENERATE_VERB_RETURN_TYPE,
    },
  };

  const callableDict = {
    message: toCallable(fnDict.message),
    embed: toCallable(fnDict.embed),
    embed_batch: toCallable(fnDict.embed_batch),
    tool_loop: toCallable(fnDict.tool_loop),
    generate: toCallable(fnDict.generate),
  } satisfies LlmExtensionContract;

  return { value: callableDict as unknown as RillValue, dispose };
}
