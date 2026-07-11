/**
 * Unit tests for prompt normalization utilities.
 *
 * Covers all 14 test scenarios specified in Task 1.1:
 * - normalizePrompt: string/list inputs, error cases EC-1..EC-10
 * - assertBoundaryRoles: EC-4
 * - assertNoTrailingAssistant: EC-5
 * - assertPartTypes: EC-7, EC-8
 * - expandContentSugar: idempotent parts-shaped pass-through
 * - MESSAGES_RETURN_TYPE: structural shape verification
 */

import { describe, it, expect } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  normalizePrompt,
  assertBoundaryRoles,
  assertNoTrailingAssistant,
  assertPartTypes,
  expandContentSugar,
  MESSAGES_RETURN_TYPE,
} from '../src/prompt.js';

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

// ============================================================
// normalizePrompt — string input
// ============================================================

describe('normalizePrompt', () => {
  describe('string input', () => {
    it('IR-1, EC-1: empty string returns invalid with raw.kind=empty_prompt', () => {
      const ctx = makeCtx();
      const result = normalizePrompt('', ctx);
      expect(isInvalid(result as never)).toBe(true);
      const status = getStatus(result as never);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.raw['kind']).toBe('empty_prompt');
    });

    it('IR-1, EC-1: whitespace-only string returns invalid with raw.kind=empty_prompt', () => {
      const ctx = makeCtx();
      const result = normalizePrompt('   ', ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe('empty_prompt');
    });

    it('IR-1: valid string returns single user message with text part', () => {
      const ctx = makeCtx();
      const result = normalizePrompt('hello', ctx);
      expect(Array.isArray(result)).toBe(true);
      const messages = result as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.parts).toHaveLength(1);
      expect(messages[0]?.parts[0]?.type).toBe('text');
      expect(messages[0]?.parts[0]?.text).toBe('hello');
    });
  });

  // ============================================================
  // normalizePrompt — list input
  // ============================================================

  describe('list input', () => {
    it('IR-1, EC-2: empty list returns invalid with raw.kind=empty_message_list', () => {
      const ctx = makeCtx();
      const result = normalizePrompt([], ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe('empty_message_list');
    });

    it('EC-3: message missing role returns invalid with raw.kind=invalid_message_format', () => {
      const ctx = makeCtx();
      const result = normalizePrompt([{ content: 'hi' }], ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe(
        'invalid_message_format'
      );
    });

    it('EC-6: message with neither parts nor content returns invalid with raw.kind=missing_message_content', () => {
      const ctx = makeCtx();
      const result = normalizePrompt([{ role: 'user' }], ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe(
        'missing_message_content'
      );
    });

    it('IR-1, IR-5: content-sugar form expands to parts', () => {
      const ctx = makeCtx();
      const result = normalizePrompt([{ role: 'user', content: 'hi' }], ctx);
      expect(Array.isArray(result)).toBe(true);
      const messages = result as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.parts[0]?.type).toBe('text');
      expect(messages[0]?.parts[0]?.text).toBe('hi');
    });

    it('IR-1: parts-form message passes through unchanged', () => {
      const ctx = makeCtx();
      const result = normalizePrompt(
        [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        ctx
      );
      expect(Array.isArray(result)).toBe(true);
      const messages = result as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      expect(messages[0]?.parts[0]?.text).toBe('hello');
    });
  });

  // ============================================================
  // normalizePrompt — invalid prompt type
  // ============================================================

  describe('invalid prompt type', () => {
    it('IR-1, EC-10: number returns invalid with raw.kind=invalid_prompt_type', () => {
      const ctx = makeCtx();
      const result = normalizePrompt(123, ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe(
        'invalid_prompt_type'
      );
    });

    it('EC-10: boolean returns invalid with raw.kind=invalid_prompt_type', () => {
      const ctx = makeCtx();
      const result = normalizePrompt(true, ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe(
        'invalid_prompt_type'
      );
    });

    it('EC-10: dict returns invalid with raw.kind=invalid_prompt_type', () => {
      const ctx = makeCtx();
      const result = normalizePrompt({ role: 'user' }, ctx);
      expect(isInvalid(result as never)).toBe(true);
      expect(getStatus(result as never).raw['kind']).toBe(
        'invalid_prompt_type'
      );
    });
  });
});

// ============================================================
// assertBoundaryRoles
// ============================================================

describe('assertBoundaryRoles', () => {
  it('IR-2, EC-4: role "tool" rejected with raw.kind=invalid_role', () => {
    const ctx = makeCtx();
    const messages = [{ role: 'tool', parts: [] }];
    const result = assertBoundaryRoles(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).raw['kind']).toBe('invalid_role');
  });

  it('IR-2: valid roles pass through as undefined', () => {
    const ctx = makeCtx();
    const messages = [
      { role: 'system', parts: [{ type: 'text', text: 'You are helpful.' }] },
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    const result = assertBoundaryRoles(messages, ctx);
    expect(result).toBeUndefined();
  });

  it('EC-4: numeric role rejected', () => {
    const ctx = makeCtx();
    const messages = [{ role: 42, parts: [] }];
    const result = assertBoundaryRoles(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(getStatus(result as never).raw['kind']).toBe('invalid_role');
  });
});

// ============================================================
// assertNoTrailingAssistant
// ============================================================

describe('assertNoTrailingAssistant', () => {
  it('IR-3, EC-5: list ending with assistant role is rejected', () => {
    const ctx = makeCtx();
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ];
    const result = assertNoTrailingAssistant(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).raw['kind']).toBe(
      'trailing_assistant_turn'
    );
  });

  it('IR-3: list ending with user role passes', () => {
    const ctx = makeCtx();
    const messages = [{ role: 'user', parts: [] }];
    const result = assertNoTrailingAssistant(messages, ctx);
    expect(result).toBeUndefined();
  });
});

// ============================================================
// assertPartTypes
// ============================================================

describe('assertPartTypes', () => {
  it('IR-4, EC-7: unsupported part type "audio" rejected', () => {
    const ctx = makeCtx();
    const messages = [
      { role: 'user', parts: [{ type: 'audio', data: 'abc' }] },
    ];
    const result = assertPartTypes(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).raw['kind']).toBe(
      'unsupported_part_type'
    );
  });

  it('IR-4, EC-8: text part missing text field rejected', () => {
    const ctx = makeCtx();
    const messages = [{ role: 'user', parts: [{ type: 'text' }] }];
    const result = assertPartTypes(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).raw['kind']).toBe('invalid_part_shape');
  });

  it('IR-4, EC-8: thinking part missing text field rejected', () => {
    const ctx = makeCtx();
    const messages = [{ role: 'assistant', parts: [{ type: 'thinking' }] }];
    const result = assertPartTypes(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(getStatus(result as never).raw['kind']).toBe('invalid_part_shape');
  });

  it('IR-4, EC-8: tool_use part missing input rejected', () => {
    const ctx = makeCtx();
    const messages = [
      { role: 'assistant', parts: [{ type: 'tool_use', id: 'x', name: 'fn' }] },
    ];
    const result = assertPartTypes(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(getStatus(result as never).raw['kind']).toBe('invalid_part_shape');
  });

  it('EC-9: image source kind "ftp" rejected with raw.kind=invalid_image_source', () => {
    const ctx = makeCtx();
    const messages = [
      {
        role: 'user',
        parts: [
          { type: 'image', source: { kind: 'ftp', data: '', media_type: '' } },
        ],
      },
    ];
    const result = assertPartTypes(messages, ctx);
    expect(result).not.toBeUndefined();
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).raw['kind']).toBe('invalid_image_source');
  });

  it('IR-4: valid text parts pass', () => {
    const ctx = makeCtx();
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ];
    const result = assertPartTypes(messages, ctx);
    expect(result).toBeUndefined();
  });

  it('IR-4: valid image parts with base64 pass', () => {
    const ctx = makeCtx();
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'image',
            source: { kind: 'base64', data: 'abc', media_type: 'image/png' },
          },
        ],
      },
    ];
    const result = assertPartTypes(messages, ctx);
    expect(result).toBeUndefined();
  });
});

// ============================================================
// expandContentSugar
// ============================================================

describe('expandContentSugar', () => {
  it('IR-5: expands {role, content: string} to parts form', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const result = expandContentSugar(messages);
    expect(result[0]).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    });
  });

  it('IR-5: idempotent — parts-shaped message passes through unchanged', () => {
    const original = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    const result = expandContentSugar(original);
    expect(result[0]).toEqual(original[0]);
  });

  it('IR-5: mixed array expands only sugar forms', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', parts: [{ type: 'text', text: 'second' }] },
    ];
    const result = expandContentSugar(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'first' }],
    });
    expect(result[1]).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'second' }],
    });
  });
});

// ============================================================
// MESSAGES_RETURN_TYPE
// ============================================================

describe('MESSAGES_RETURN_TYPE', () => {
  it('IR-6: is a defined value (not undefined or null)', () => {
    expect(MESSAGES_RETURN_TYPE).toBeDefined();
    expect(MESSAGES_RETURN_TYPE).not.toBeNull();
  });

  it('IR-6: has structure.kind = list with a Message element', () => {
    // structureToTypeValue wraps the TypeStructure in a RillTypeValue.
    // The underlying structure is accessible via the .structure property.
    const typeValue = MESSAGES_RETURN_TYPE as {
      structure?: {
        kind: string;
        element?: { kind: string; fields?: Record<string, unknown> };
      };
    };
    expect(typeValue.structure?.kind).toBe('list');
    expect(typeValue.structure?.element?.kind).toBe('dict');
    const fields = typeValue.structure?.element?.fields as
      | Record<string, { type: { kind: string } }>
      | undefined;
    expect(fields?.['role']?.type?.kind).toBe('string');
    expect(fields?.['parts']?.type?.kind).toBe('list');
  });
});
