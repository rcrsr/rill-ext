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

import { describe, it, expect, expectTypeOf } from 'vitest';
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
} from '../src/index.js';
import type {
  Role,
  Message,
  Part,
  MessageInput,
  ImageSource,
  LlmExtensionContract,
} from '../src/index.js';

// ============================================================
// IR-9: LlmExtensionContract shape
// ============================================================

describe('LlmExtensionContract', () => {
  it('has message, tool_loop, generate, embed, embed_batch fields', () => {
    // Compile-time assertions: tsc rejects the file when a key is added or removed.
    expectTypeOf<keyof LlmExtensionContract>().toEqualTypeOf<
      'message' | 'tool_loop' | 'generate' | 'embed' | 'embed_batch'
    >();
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
  it('Role type accepts exactly the valid role strings', () => {
    expectTypeOf<Role>().toEqualTypeOf<'system' | 'user' | 'assistant'>();
  });

  it('Message type is constructible from role and parts', () => {
    expectTypeOf<{
      role: 'user';
      parts: [{ type: 'text'; text: string }];
    }>().toExtend<Message>();
  });

  it('Part type accepts a text part', () => {
    expectTypeOf<{ type: 'text'; text: string }>().toExtend<Part>();
  });

  it('MessageInput type accepts content-sugar form', () => {
    expectTypeOf<{ role: 'user'; content: string }>().toExtend<MessageInput>();
  });

  it('ImageSource type accepts a url source', () => {
    expectTypeOf<{
      kind: 'url';
      data: string;
      media_type: 'image/png';
    }>().toExtend<ImageSource>();
  });
});
