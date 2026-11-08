/**
 * Pure helpers for the Gemini extension: return-type constants, halt
 * builders, error detection, wire translators, and client option resolution.
 */

import {
  Type,
  type Content,
  type GoogleGenAIOptions,
  type Part as GeminiPart,
  type Schema,
} from '@google/genai';
import {
  RuntimeError,
  RuntimeHaltSignal,
  getStatus,
  structureToTypeValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  MESSAGE_DICT_STRUCTURE,
  mapProviderError,
  validateApiKey,
  type JsonSchemaProperty,
  type Message,
  type Part,
  type ProviderErrorDetector,
} from '@rcrsr/rill-ext-llm-shared';
import type { GeminiExtensionConfig } from './types.js';

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
export const MESSAGE_RET_STRUCTURE = {
  kind: 'dict' as const,
  fields: {
    messages: { type: MESSAGES_FIELD_STRUCTURE },
    model: { type: { kind: 'string' as const } },
    usage: { type: USAGE_FIELD_STRUCTURE },
    stop_reason: { type: { kind: 'string' as const } },
    id: { type: { kind: 'string' as const } },
  },
};

export const MESSAGE_VERB_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'string' },
  ret: MESSAGE_RET_STRUCTURE,
});

export const TOOL_LOOP_VERB_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'dict' },
  ret: MESSAGE_RET_STRUCTURE,
});

export const GENERATE_VERB_RETURN_TYPE = structureToTypeValue({
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
export function mapToHalt(
  ctx: RuntimeContext,
  error: unknown
): RuntimeHaltSignal {
  const invalid = mapProviderError(ctx, 'Gemini', error, detectGeminiError);
  return new RuntimeHaltSignal(invalid, true);
}

/**
 * Build an invalid-RillValue halt signal carrying a generic atom.
 * Host scripts recover via `guard #<ATOM>`.
 */
export function haltInvalid(
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

export function streamErrorMessage(
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
    if (statusMatch?.[1] !== undefined && statusMatch[1] !== '') {
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
export function toGeminiSchema(prop: JsonSchemaProperty): Schema {
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
          args: part.input,
        },
      };

    case 'tool_result': {
      // Canonical tool_result → Gemini functionResponse
      // Collapse nested parts to a text string for the response body
      const responseText = part.parts
        .map((pt) =>
          pt.type === 'text' || pt.type === 'thinking'
            ? pt.text
            : JSON.stringify(pt)
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
  throw new RuntimeError(
    'RILL-R001',
    'gemini: unsupported canonical part type'
  );
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
export function canonicalToGeminiContents(messages: Message[]): {
  contents: Content[];
  systemInstruction: string | undefined;
} {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Lift system turn to systemInstruction; use text from first text part
      const textPart = msg.parts.find(
        (part) => part.type === 'text' || part.type === 'thinking'
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
export function resolveGoogleGenAIOptions(
  config: GeminiExtensionConfig
): GoogleGenAIOptions {
  const httpOptions = buildHttpOptions(config);

  if (config.vertexai !== true) {
    // Mode 1: Gemini Developer API (default). Self-contained validation
    // narrows config.api_key to string via the `asserts` return type; the
    // up-front check in createGeminiExtension preserves validation ordering
    // (api_key before model/temperature/etc), this call is redundant but
    // cheap and removes the cross-function invariant.
    validateApiKey(config.api_key);
    return {
      apiKey: config.api_key,
      ...(httpOptions !== undefined ? { httpOptions } : {}),
    };
  }

  if (config.api_key !== undefined) {
    // Mode 2: Vertex Express (apiKey-based auth against Vertex AI)
    validateApiKey(config.api_key);
    return {
      vertexai: true,
      apiKey: config.api_key,
      ...(httpOptions !== undefined ? { httpOptions } : {}),
    };
  }

  // Mode 3: Vertex ADC (project/location-based auth)
  if (config.project === undefined || config.project === '') {
    throw new RuntimeError('RILL-R001', 'project is required for Vertex AI');
  }
  if (config.location === undefined || config.location === '') {
    throw new RuntimeError('RILL-R001', 'location is required for Vertex AI');
  }
  return {
    vertexai: true,
    project: config.project,
    location: config.location,
    ...(httpOptions !== undefined ? { httpOptions } : {}),
  };
}
