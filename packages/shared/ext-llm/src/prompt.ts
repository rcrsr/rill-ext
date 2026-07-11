/**
 * Prompt normalization utilities for LLM extensions.
 *
 * Converts raw RillValue inputs (string or list of message dicts) into
 * canonical parts-shaped Message arrays. Provides validation functions
 * and the declarative MESSAGES_RETURN_TYPE constant.
 *
 * Consumed by all three LLM extensions (anthropic, openai, gemini).
 * `normalizePrompt` is the entry point for the `message()` host function,
 * which accepts both a plain string (single user turn) and a list of message
 * dicts (multi-turn conversation). The `messages` verb was removed; callers
 * pass lists directly to `message()`.
 *
 * Part-type allowlist (v1): `text`, `thinking`, `tool_use`, `tool_result`,
 * `image`. All other `type` values are rejected at the boundary by
 * `assertPartTypes` (EC-7).
 *
 * `MESSAGES_RETURN_TYPE` is the canonical `RillTypeValue` for any host
 * function that returns a message list. Extensions use it as the
 * `returnType` field in `RillFunction` declarations for `message()` and
 * `tool_loop()`. For raw `TypeStructure` composition (e.g., inside a
 * stream `retType`), use `MESSAGES_LIST_STRUCTURE` or
 * `MESSAGE_DICT_STRUCTURE` directly.
 *
 * IR-1:  normalizePrompt — string or list → Message[]
 * IR-2:  assertBoundaryRoles — validate role allowlist
 * IR-3:  assertNoTrailingAssistant — reject trailing assistant turn
 * IR-4:  assertPartTypes — validate part type allowlist and shapes
 * IR-5:  expandContentSugar — {role, content:string} → {role, parts:[...]}
 * IR-6:  MESSAGES_RETURN_TYPE — declarative TypeStructure for return type
 */

import {
  structureToTypeValue,
  type RillValue,
  type RuntimeContext,
  type TypeStructure,
} from '@rcrsr/rill';

// ============================================================
// CANONICAL TYPES
// ============================================================

/** Valid roles at the rill host-function boundary. */
export type Role = 'system' | 'user' | 'assistant';

/** Text content part — used in all roles. */
interface TextPart {
  type: 'text';
  text: string;
}

/** Thinking content part — assistant-only on output. */
interface ThinkingPart {
  type: 'thinking';
  text: string;
}

/** Tool invocation — assistant-only. */
interface ToolUsePart {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, RillValue>;
}

/** Tool result — user-only. */
interface ToolResultPart {
  type: 'tool_result';
  id: string;
  name?: string;
  parts: Array<Part>;
}

/** Image source descriptor. */
export interface ImageSource {
  kind: 'base64' | 'url';
  data: string;
  media_type: string;
}

/** Image content part — user input only in v1. */
interface ImagePart {
  type: 'image';
  source: ImageSource;
}

/** Discriminated union of all part variants. */
export type Part =
  | TextPart
  | ThinkingPart
  | ToolUsePart
  | ToolResultPart
  | ImagePart;

/** Canonical message — always parts-shaped. */
export interface Message {
  role: Role;
  parts: Array<Part>;
}

/** Input message — either canonical or content-sugar form. */
export type MessageInput = Message | { role: Role; content: string };

// ============================================================
// CONSTANTS
// ============================================================

/** Valid role names at the boundary. */
const VALID_ROLES: ReadonlySet<string> = new Set([
  'system',
  'user',
  'assistant',
]);

/** Valid part types in v1. */
const VALID_PART_TYPES: ReadonlySet<string> = new Set([
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'image',
]);

// ============================================================
// IR-6: MESSAGES_RETURN_TYPE
// ============================================================

/**
 * Declarative TypeStructure covering the image source shape:
 * { kind: string, data: string, media_type: string }
 */
const IMAGE_SOURCE_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    kind: { type: { kind: 'string' } },
    data: { type: { kind: 'string' } },
    media_type: { type: { kind: 'string' } },
  },
};

/**
 * Parts list TypeStructure — covers a superset of all part variant fields.
 *
 * The `tool_result.parts` field is recursive. Rather than infinite
 * recursion, we declare it as an unparameterised list (depth-1 assumption).
 * Callers that need to introspect nested tool_result parts must match on
 * the runtime value. The boundary contract (field names and types at the
 * top level) is unchanged.
 */
export const PARTS_LIST_STRUCTURE: TypeStructure = {
  kind: 'list',
  element: {
    kind: 'dict',
    fields: {
      // Discriminator present on every part variant
      type: { type: { kind: 'string' } },
      // TextPart / ThinkingPart fields
      text: { type: { kind: 'string' } },
      // ToolUsePart fields
      id: { type: { kind: 'string' } },
      name: { type: { kind: 'string' } },
      input: { type: { kind: 'dict' } },
      // ToolResultPart — nested parts; declared as unparameterised list (depth-1)
      parts: { type: { kind: 'list' } },
      // ImagePart field
      source: { type: IMAGE_SOURCE_STRUCTURE },
    },
  },
};

/**
 * Declarative TypeStructure for a single message dict:
 * { role: string, parts: list<Part> }
 *
 * Exported so factories embedding the messages list inside a wider stream/dict
 * `retType` (which requires raw `TypeStructure`) can compose rich shapes
 * without losing field detail under §EXT.8.1.
 */
export const MESSAGE_DICT_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    role: { type: { kind: 'string' } },
    parts: { type: PARTS_LIST_STRUCTURE },
  },
};

/**
 * Declarative TypeStructure for the messages list:
 * list<{ role: string, parts: list<Part> }>
 *
 * Exported so factories can use this as a `TypeStructure` directly (e.g. in
 * `createRillStream.retType`). For `RillFunction.returnType` slots that
 * require a `RillTypeValue`, use `MESSAGES_RETURN_TYPE` below.
 */
export const MESSAGES_LIST_STRUCTURE: TypeStructure = {
  kind: 'list',
  element: MESSAGE_DICT_STRUCTURE,
};

/**
 * Declarative return-type constant for host functions that return a
 * message list. Used as `RillFunction.returnType` in `message()` and
 * `tool_loop()` declarations across all LLM extensions.
 *
 * Shape: list<{ role: string, parts: list<Part> }>
 *
 * Part variants covered: `text`, `thinking`, `tool_use`, `tool_result`,
 * `image`. These correspond to the v1 allowlist enforced by
 * `assertPartTypes`. The `type` field on each part dict acts as the
 * discriminator that host scripts inspect at runtime.
 *
 * The wrapper result dict (`model`, `usage`, `stop_reason`, `id`,
 * `messages`) is declared separately per factory. This constant
 * represents only the `messages` list element of that wrapper.
 */
export const MESSAGES_RETURN_TYPE = structureToTypeValue(
  MESSAGES_LIST_STRUCTURE
);

// ============================================================
// IR-5: expandContentSugar
// ============================================================

/**
 * Expands content-sugar form `{role, content: string}` to parts form.
 *
 * Idempotent: messages already in parts form pass through unchanged.
 *
 * @param messages - Array of canonical or sugar-form messages as plain dicts
 * @returns Array of Message objects in canonical parts form
 */
export function expandContentSugar(
  messages: Array<Record<string, RillValue>>
): Array<Record<string, RillValue>> {
  return messages.map((msg) => {
    // Already parts-shaped — pass through
    if ('parts' in msg) {
      return msg;
    }
    // Sugar form: content string → [{type:'text', text}]
    const content = msg['content'] ?? '';
    const role = msg['role'] ?? '';
    const expanded: Record<string, RillValue> = {
      role,
      parts: [{ type: 'text' as RillValue, text: content }],
    };
    return expanded;
  });
}

// ============================================================
// IR-2: assertBoundaryRoles
// ============================================================

/**
 * Validates that every message role is in the `system`/`user`/`assistant` allowlist.
 *
 * Returns an invalid RillValue when validation fails, undefined when valid.
 * EC-3: Message missing `role` → INVALID_INPUT / invalid_message_format
 * EC-4: Role not in allowlist → INVALID_INPUT / invalid_role
 *
 * @param messages - Already-expanded messages (parts form)
 * @param ctx - Runtime context
 * @returns Invalid RillValue on first violation, undefined when valid
 */
export function assertBoundaryRoles(
  messages: Array<Record<string, RillValue>>,
  ctx: RuntimeContext
): RillValue | undefined {
  for (const msg of messages) {
    if (!('role' in msg) || msg['role'] === undefined || msg['role'] === null) {
      return ctx.invalidate(new Error('message missing required role field'), {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'invalid_message_format' },
      });
    }

    const role = msg['role'];
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) {
      return ctx.invalidate(new Error(`invalid role '${String(role)}'`), {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'invalid_role', role: String(role) },
      });
    }
  }
  return undefined;
}

// ============================================================
// IR-3: assertNoTrailingAssistant
// ============================================================

/**
 * Rejects message lists that end with an assistant turn.
 *
 * EC-5: Final message is assistant role → INVALID_INPUT / trailing_assistant_turn
 *
 * @param messages - Already-expanded messages (parts form)
 * @param ctx - Runtime context
 * @returns Invalid RillValue when the list ends with assistant, undefined otherwise
 */
export function assertNoTrailingAssistant(
  messages: Array<Record<string, RillValue>>,
  ctx: RuntimeContext
): RillValue | undefined {
  const last = messages[messages.length - 1];
  if (last && last['role'] === 'assistant') {
    return ctx.invalidate(
      new Error('message list cannot end with an assistant turn'),
      {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'trailing_assistant_turn' },
      }
    );
  }
  return undefined;
}

// ============================================================
// IR-4: assertPartTypes
// ============================================================

/**
 * Validates that every part type is in the v1 allowlist and that required
 * fields are present for each declared type.
 *
 * EC-7: Part type not in allowlist → INVALID_INPUT / unsupported_part_type
 * EC-8: Part shape invalid for declared type → INVALID_INPUT / invalid_part_shape
 * EC-9: Image source kind not base64/url → INVALID_INPUT / invalid_image_source
 *
 * @param messages - Already-expanded messages (parts form)
 * @param ctx - Runtime context
 * @returns Invalid RillValue on first violation, undefined when valid
 */
export function assertPartTypes(
  messages: Array<Record<string, RillValue>>,
  ctx: RuntimeContext
): RillValue | undefined {
  for (const msg of messages) {
    const parts = msg['parts'];
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const rawPart of parts) {
      if (
        typeof rawPart !== 'object' ||
        rawPart === null ||
        Array.isArray(rawPart)
      ) {
        return ctx.invalidate(new Error('part must be a dict'), {
          code: 'INVALID_INPUT',
          provider: '',
          raw: { kind: 'invalid_part_shape' },
        });
      }

      const part = rawPart as Record<string, RillValue>;
      const partType = part['type'];

      if (typeof partType !== 'string' || !VALID_PART_TYPES.has(partType)) {
        return ctx.invalidate(
          new Error(`unsupported part type '${String(partType)}'`),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: { kind: 'unsupported_part_type', type: String(partType) },
          }
        );
      }

      // Shape validation per declared type
      const shapeError = validatePartShape(part, partType, ctx);
      if (shapeError !== undefined) {
        return shapeError;
      }
    }
  }
  return undefined;
}

/**
 * Validates required fields are present for each part type.
 * Returns invalid RillValue on shape violation, undefined when valid.
 */
function validatePartShape(
  part: Record<string, RillValue>,
  partType: string,
  ctx: RuntimeContext
): RillValue | undefined {
  switch (partType) {
    case 'text':
    case 'thinking': {
      if (typeof part['text'] !== 'string') {
        return ctx.invalidate(
          new Error(`${partType} part missing required 'text' field`),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: partType,
              missing_field: 'text',
            },
          }
        );
      }
      return undefined;
    }

    case 'tool_use': {
      if (typeof part['id'] !== 'string') {
        return ctx.invalidate(
          new Error("tool_use part missing required 'id' field"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'tool_use',
              missing_field: 'id',
            },
          }
        );
      }
      if (typeof part['name'] !== 'string') {
        return ctx.invalidate(
          new Error("tool_use part missing required 'name' field"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'tool_use',
              missing_field: 'name',
            },
          }
        );
      }
      if (
        typeof part['input'] !== 'object' ||
        part['input'] === null ||
        Array.isArray(part['input'])
      ) {
        return ctx.invalidate(
          new Error("tool_use part missing required 'input' dict"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'tool_use',
              missing_field: 'input',
            },
          }
        );
      }
      return undefined;
    }

    case 'tool_result': {
      if (typeof part['id'] !== 'string') {
        return ctx.invalidate(
          new Error("tool_result part missing required 'id' field"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'tool_result',
              missing_field: 'id',
            },
          }
        );
      }
      if (!Array.isArray(part['parts'])) {
        return ctx.invalidate(
          new Error("tool_result part missing required 'parts' array"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'tool_result',
              missing_field: 'parts',
            },
          }
        );
      }
      return undefined;
    }

    case 'image': {
      const source = part['source'];
      if (
        typeof source !== 'object' ||
        source === null ||
        Array.isArray(source)
      ) {
        return ctx.invalidate(
          new Error("image part missing required 'source' dict"),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: {
              kind: 'invalid_part_shape',
              part_type: 'image',
              missing_field: 'source',
            },
          }
        );
      }
      const src = source as Record<string, RillValue>;
      const srcKind = src['kind'];
      if (srcKind !== 'base64' && srcKind !== 'url') {
        return ctx.invalidate(
          new Error(`invalid image source kind '${String(srcKind)}'`),
          {
            code: 'INVALID_INPUT',
            provider: '',
            raw: { kind: 'invalid_image_source', source_kind: String(srcKind) },
          }
        );
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

// ============================================================
// IR-1: normalizePrompt
// ============================================================

/**
 * Normalizes a raw RillValue prompt into a canonical Message array.
 *
 * Input: string (single user turn) OR list of message dicts (canonical or sugar)
 * Output: Message[] — always parts-shaped, validated
 *
 * Pure function; no side effects; idempotent.
 *
 * Error codes (EC-1..EC-10) emit via ctx.invalidate with INVALID_INPUT.
 *
 * @param rawPrompt - String, list of message dicts, or invalid type
 * @param ctx - Runtime context for error emission
 * @returns Normalized message array or an invalid RillValue on failure
 */
export function normalizePrompt(
  rawPrompt: RillValue,
  ctx: RuntimeContext
): Array<Message> | RillValue {
  // EC-10: Prompt is neither string nor list
  if (typeof rawPrompt !== 'string' && !Array.isArray(rawPrompt)) {
    return ctx.invalidate(
      new Error('prompt must be a string or list of messages'),
      {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'invalid_prompt_type' },
      }
    );
  }

  // String path: single user turn
  if (typeof rawPrompt === 'string') {
    // EC-1: Empty string
    if (rawPrompt.trim().length === 0) {
      return ctx.invalidate(new Error('prompt string cannot be empty'), {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'empty_prompt' },
      });
    }

    return [
      {
        role: 'user',
        parts: [{ type: 'text', text: rawPrompt }],
      },
    ];
  }

  // List path
  const list = rawPrompt as RillValue[];

  // EC-2: Empty list
  if (list.length === 0) {
    return ctx.invalidate(new Error('message list cannot be empty'), {
      code: 'INVALID_INPUT',
      provider: '',
      raw: { kind: 'empty_message_list' },
    });
  }

  // Validate each item is a dict, then check for role and content/parts
  const rawMessages: Array<Record<string, RillValue>> = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return ctx.invalidate(new Error('each message must be a dict'), {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'invalid_message_format' },
      });
    }

    const msg = item as Record<string, RillValue>;

    // EC-3: Message missing role
    if (!('role' in msg) || msg['role'] === undefined || msg['role'] === null) {
      return ctx.invalidate(new Error('message missing required role field'), {
        code: 'INVALID_INPUT',
        provider: '',
        raw: { kind: 'invalid_message_format' },
      });
    }

    // EC-6: Message has neither parts nor content
    if (!('parts' in msg) && !('content' in msg)) {
      return ctx.invalidate(
        new Error('message must have either parts or content'),
        {
          code: 'INVALID_INPUT',
          provider: '',
          raw: { kind: 'missing_message_content' },
        }
      );
    }

    rawMessages.push(msg);
  }

  // IR-2: Validate roles before expansion
  const roleError = assertBoundaryRoles(rawMessages, ctx);
  if (roleError !== undefined) {
    return roleError;
  }

  // IR-5: Expand content sugar
  const expanded = expandContentSugar(rawMessages);

  // IR-3: No trailing assistant
  const trailingError = assertNoTrailingAssistant(expanded, ctx);
  if (trailingError !== undefined) {
    return trailingError;
  }

  // IR-4: Validate part types and shapes
  const partError = assertPartTypes(expanded, ctx);
  if (partError !== undefined) {
    return partError;
  }

  // Safe to cast — all validations passed
  return expanded as unknown as Array<Message>;
}
