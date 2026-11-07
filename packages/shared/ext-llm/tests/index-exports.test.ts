/**
 * Smoke tests for the ext-llm shared barrel (src/index.ts).
 *
 * Verifies that every symbol required by the spec (Task 1.4) is reachable
 * via the public barrel. Tests cover:
 *   - IR-9: LlmExtensionContract has no `messages` field
 *   - IR-9: LlmExtensionContract.tool_loop and .generate fields present
 *   - Barrel: types importable (validated at typecheck time)
 */

import { describe, it, expectTypeOf } from 'vitest';
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
