/**
 * Smoke tests for the ext-llm shared barrel (src/index.ts).
 *
 * Verifies that every symbol required by the spec (Task 1.4) is reachable
 * via the public barrel. Tests cover:
 *   - IR-9: LlmExtensionContract has no `messages` field
 *   - IR-9: LlmExtensionContract.tool_loop and .generate fields present
 *   - Barrel: runtime values (functions, constants) importable
 *   - Barrel: types importable (validated at typecheck time)
 *   - validateMessages: accepts parts form and content-sugar form
 */

import { describe, it, expect } from 'vitest';
import {
  // Constants
  MESSAGES_RETURN_TYPE,
  RESERVED_KEYS_COMMON,
  // Functions
  normalizePrompt,
  assertBoundaryRoles,
  assertNoTrailingAssistant,
  assertPartTypes,
  expandContentSugar,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
  validateMessages,
} from '../src/index.js';
import type {
  Role,
  Message,
  Part,
  MessageInput,
  ImageSource,
  LlmExtensionContract,
} from '../src/index.js';
import { createRuntimeContext } from '@rcrsr/rill';

// ============================================================
// IR-9: LlmExtensionContract shape
// ============================================================

describe('LlmExtensionContract', () => {
  it('has message, tool_loop, generate, embed, embed_batch fields', () => {
    // Type-level assertion: assign an object satisfying the contract.
    // The TypeScript compiler rejects any object that omits a required field
    // or includes a disallowed field like `messages`.
    type RequiredKeys = keyof LlmExtensionContract;

    // Compile-time check: 'messages' must NOT be a key of the contract.
    // We use a conditional type that resolves to `never` if messages is present.
    type MessagesAbsent = 'messages' extends RequiredKeys ? never : true;
    const _check: MessagesAbsent = true;
    expect(_check).toBe(true);

    // Compile-time check: required keys are present.
    type HasMessage = 'message' extends RequiredKeys ? true : never;
    type HasToolLoop = 'tool_loop' extends RequiredKeys ? true : never;
    type HasGenerate = 'generate' extends RequiredKeys ? true : never;
    type HasEmbed = 'embed' extends RequiredKeys ? true : never;
    type HasEmbedBatch = 'embed_batch' extends RequiredKeys ? true : never;

    const _m: HasMessage = true;
    const _tl: HasToolLoop = true;
    const _g: HasGenerate = true;
    const _e: HasEmbed = true;
    const _eb: HasEmbedBatch = true;

    expect(_m).toBe(true);
    expect(_tl).toBe(true);
    expect(_g).toBe(true);
    expect(_e).toBe(true);
    expect(_eb).toBe(true);
  });
});

// ============================================================
// Barrel: runtime values
// ============================================================

describe('barrel runtime exports', () => {
  it('exports MESSAGES_RETURN_TYPE as a non-null object', () => {
    expect(MESSAGES_RETURN_TYPE).toBeDefined();
    expect(typeof MESSAGES_RETURN_TYPE).toBe('object');
    expect(MESSAGES_RETURN_TYPE).not.toBeNull();
  });

  it('exports RESERVED_KEYS_COMMON as a non-empty array', () => {
    expect(Array.isArray(RESERVED_KEYS_COMMON)).toBe(true);
    expect(RESERVED_KEYS_COMMON.length).toBeGreaterThan(0);
  });

  it('exports normalizePrompt as a function', () => {
    expect(typeof normalizePrompt).toBe('function');
  });

  it('exports assertBoundaryRoles as a function', () => {
    expect(typeof assertBoundaryRoles).toBe('function');
  });

  it('exports assertNoTrailingAssistant as a function', () => {
    expect(typeof assertNoTrailingAssistant).toBe('function');
  });

  it('exports assertPartTypes as a function', () => {
    expect(typeof assertPartTypes).toBe('function');
  });

  it('exports expandContentSugar as a function', () => {
    expect(typeof expandContentSugar).toBe('function');
  });

  it('exports validateExtraKeys as a function', () => {
    expect(typeof validateExtraKeys).toBe('function');
  });

  it('exports validateMaxTurns as a function', () => {
    expect(typeof validateMaxTurns).toBe('function');
  });

  it('exports validateMaxErrors as a function', () => {
    expect(typeof validateMaxErrors).toBe('function');
  });
});

// ============================================================
// Barrel: type-only exports (smoke via assignability)
// ============================================================

describe('barrel type exports', () => {
  it('Role type is assignable from valid role strings', () => {
    const r: Role = 'user';
    expect(r).toBe('user');
  });

  it('Message type is constructible', () => {
    const m: Message = { role: 'user', parts: [{ type: 'text', text: 'hi' }] };
    expect(m.role).toBe('user');
  });

  it('Part type is assignable from a TextPart', () => {
    const p: Part = { type: 'text', text: 'hello' };
    expect(p.type).toBe('text');
  });

  it('MessageInput type accepts content-sugar form', () => {
    const mi: MessageInput = { role: 'user', content: 'hello' };
    expect(mi.role).toBe('user');
  });

  it('ImageSource type is constructible', () => {
    const src: ImageSource = {
      kind: 'url',
      data: 'https://example.com/img.png',
      media_type: 'image/png',
    };
    expect(src.kind).toBe('url');
  });
});

// ============================================================
// validateMessages: both old and new message shapes accepted
// ============================================================

describe('validateMessages migration path', () => {
  it('accepts parts-shaped messages (canonical form)', () => {
    expect(() =>
      validateMessages([
        { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      ])
    ).not.toThrow();
  });

  it('accepts content-sugar-shaped messages (old form)', () => {
    expect(() =>
      validateMessages([{ role: 'user', content: 'hello' }])
    ).not.toThrow();
  });

  it('throws for empty messages array', () => {
    expect(() => validateMessages([])).toThrow('messages list cannot be empty');
  });

  it('throws for message missing both parts and content', () => {
    expect(() => validateMessages([{ role: 'user' }])).toThrow(
      "parts' or 'content'"
    );
  });

  it('throws for message missing role', () => {
    expect(() => validateMessages([{ content: 'hello' }])).toThrow('role');
  });
});

// ============================================================
// normalizePrompt (via barrel): basic integration smoke
// ============================================================

describe('normalizePrompt via barrel', () => {
  const ctx = createRuntimeContext();

  it('normalizes a string prompt to a single user message', () => {
    const result = normalizePrompt('hello', ctx);
    expect(Array.isArray(result)).toBe(true);
    const msgs = result as Message[];
    expect(msgs[0]?.role).toBe('user');
  });

  it('normalizes a list of content-sugar messages', () => {
    const result = normalizePrompt([{ role: 'user', content: 'hi' }], ctx);
    expect(Array.isArray(result)).toBe(true);
  });
});
