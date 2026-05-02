/**
 * Boundary and error-case tests for the Anthropic unified-prompting AC-* surface.
 *
 * Exercises edge cases, factory-time validation, and error code coverage.
 *
 * Covered: AC-B1, AC-B2, AC-B3, AC-B4, AC-B6, AC-B7, AC-B8,
 *          AC-E1, AC-E3, AC-E4, AC-E5, AC-E6, AC-E7, AC-E9,
 *          AC-E13, AC-E14, AC-E15
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, RuntimeHaltSignal, getStatus, type ApplicationCallable } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import { expectThrowHalt } from './_halt-helpers.js';

// ============================================================
// MOCK SETUP (mirrors tool-loop.test.ts pattern)
// ============================================================

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(status: number, _error: any, message: string, _headers: any) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function createMockStream(content: string) {
  const response = {
    id: 'msg_boundary_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 10 },
  };

  return {
    [Symbol.asyncIterator]: async function* () {
      if (content.length > 0) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: content } };
      }
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  };
}

const baseConfig: AnthropicExtensionConfig = {
  api_key: 'test-key',
  model: 'claude-sonnet-4-5-20250929',
};

// ============================================================
// BOUNDARY CONDITIONS
// ============================================================

describe('boundary conditions', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // ──────────────────────────────────────────────────────────
  // AC-B1: Single system-only turn (no terminal user turn)
  // ──────────────────────────────────────────────────────────
  // normalizePrompt does not reject a system-only list; the system turn is
  // lifted to the top-level system param by canonicalToAnthropicMessages,
  // leaving an empty messages array sent to the SDK. The real SDK rejects
  // an empty messages array, but normalizePrompt itself does not enforce
  // "must end in user turn". [DEVIATION] documented in Implementation Notes.
  describe('AC-B1: system-only prompt', () => {
    it('sends empty messages array to SDK when only a system turn is provided', () => {
      // The mock accepts the empty messages array; real SDK would reject it.
      mockStream.mockReturnValue(createMockStream('response'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'system', parts: [{ type: 'text', text: 'You are a helpful assistant' }] },
      ];

      // normalizePrompt does not reject this — no user-turn required at this layer.
      expect(() =>
        getCallable(ext, 'message').fn({ prompt }, ctx)
      ).not.toThrow();

      // Verify the SDK was called with an empty messages array
      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as unknown[];
      expect(messages).toHaveLength(0);
      expect(callArgs['system']).toBe('You are a helpful assistant');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B2: Multiple consecutive user turns
  // ──────────────────────────────────────────────────────────
  describe('AC-B2: multiple consecutive user turns accepted', () => {
    it('accepts message list with two consecutive user turns', () => {
      mockStream.mockReturnValue(createMockStream('response'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', parts: [{ type: 'text', text: 'First question' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Second question' }] },
      ];

      expect(() =>
        getCallable(ext, 'message').fn({ prompt }, ctx)
      ).not.toThrow();

      expect(mockStream).toHaveBeenCalledOnce();
      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{ role: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe('user');
      expect(messages[1]!.role).toBe('user');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B3: User turn with image-only part (no text)
  // ──────────────────────────────────────────────────────────
  describe('AC-B3: user turn with image-only part accepted', () => {
    it('accepts user turn containing only an image part', () => {
      mockStream.mockReturnValue(createMockStream('Seen'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: {
                kind: 'base64',
                data: 'abc123',
                media_type: 'image/png',
              },
            },
          ],
        },
      ];

      expect(() =>
        getCallable(ext, 'message').fn({ prompt }, ctx)
      ).not.toThrow();

      expect(mockStream).toHaveBeenCalledOnce();
      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{
        role: string;
        content: Array<{ type: string }>;
      }>;

      expect(messages[0]!.role).toBe('user');
      const imageBlock = (messages[0]!.content as Array<{ type: string }>).find((b) => b.type === 'image');
      expect(imageBlock).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B4: tool_loop with empty tools dict → INVALID_INPUT
  //         raw.kind = 'empty_tools_dict'  (EC-14 coverage)
  // ──────────────────────────────────────────────────────────
  describe('AC-B4: tool_loop with empty tools dict rejects with INVALID_INPUT', () => {
    it('throws halt with code INVALID_INPUT and raw.kind empty_tools_dict', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'tool_loop').fn(
            { prompt: 'test', tools: {}, max_turns: 0 },
            ctx
          ),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'empty_tools_dict' });
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B6: Factory config extra: {} (empty dict) passes
  // ──────────────────────────────────────────────────────────
  describe('AC-B6: factory config extra: {} treated as no extras', () => {
    it('creates extension without error when extra is an empty dict', () => {
      expect(() =>
        createAnthropicExtension({ ...baseConfig, extra: {} })
      ).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B7: Factory config max_turns: 0 rejected at factory init
  // ──────────────────────────────────────────────────────────
  describe('AC-B7: factory config max_turns: 0 rejected at factory init', () => {
    it('throws RuntimeError with verbatim RILL-R001 message for max_turns: 0', () => {
      expect(() =>
        createAnthropicExtension({ ...baseConfig, max_turns: 0 })
      ).toThrow(
        "Factory config 'max_turns' must be a positive integer or undefined; sentinel value 0 is reserved for per-call override semantics."
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B8: 10 parallel message() calls share factory extra and config
  //         without mutation — extra object reference unchanged after calls
  // ──────────────────────────────────────────────────────────
  describe('AC-B8: parallel message() calls do not mutate shared factory extra', () => {
    it('extra object reference is the same instance after 10 parallel calls', () => {
      mockStream.mockImplementation(() => createMockStream('ok'));

      const extra = { top_k: 5 };
      const ext = createAnthropicExtension({ ...baseConfig, extra });
      const ctx = createRuntimeContext();

      // Capture extra reference before calls
      const extraBefore = extra;

      // Fire 10 calls in parallel; message() is synchronous up to SDK call
      for (let i = 0; i < 10; i++) {
        getCallable(ext, 'message').fn({ prompt: `Question ${i}` }, ctx);
      }

      // extra object must be the same reference — no mutation occurred
      expect(extra).toBe(extraBefore);
      // No new keys were added
      expect(Object.keys(extra)).toEqual(['top_k']);
      // Value unchanged
      expect(extra.top_k).toBe(5);
    });
  });
});

// ============================================================
// ERROR CASES
// ============================================================

describe('error cases', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // ──────────────────────────────────────────────────────────
  // AC-E1: message([{role:'tool', ...}]) → INVALID_INPUT, 'tool' named
  // ──────────────────────────────────────────────────────────
  describe('AC-E1: tool role rejected', () => {
    it('rejects prompt with role:tool with INVALID_INPUT', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn(
            { prompt: [{ role: 'tool', content: 'result' }] },
            ctx
          ),
        { code: 'INVALID_INPUT' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E3: message([{role:'foo', ...}]) → INVALID_INPUT
  // ──────────────────────────────────────────────────────────
  describe('AC-E3: unknown role rejected', () => {
    it('rejects prompt with unknown role "foo" with INVALID_INPUT', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn(
            { prompt: [{ role: 'foo', content: 'hello' }] },
            ctx
          ),
        { code: 'INVALID_INPUT' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E4: trailing assistant turn → INVALID_INPUT, raw.kind=trailing_assistant_turn
  // ──────────────────────────────────────────────────────────
  describe('AC-E4: trailing assistant turn rejected', () => {
    it('rejects message list ending with assistant turn (raw.kind: trailing_assistant_turn)', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn(
            {
              prompt: [
                { role: 'user', content: 'hi' },
                {
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'hello' }],
                },
              ],
            },
            ctx
          ),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'trailing_assistant_turn' });
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E5: audio part → INVALID_INPUT naming 'audio'
  // ──────────────────────────────────────────────────────────
  describe('AC-E5: unsupported part type "audio" rejected', () => {
    it('rejects user turn with audio part type, naming "audio" in error', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn(
            {
              prompt: [
                {
                  role: 'user',
                  parts: [{ type: 'audio', data: 'base64audiodata', format: 'mp3' }],
                },
              ],
            },
            ctx
          ),
        { code: 'INVALID_INPUT', message: 'audio' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E6: Factory extra with model key → RILL-R001
  // ──────────────────────────────────────────────────────────
  describe('AC-E6: factory extra with reserved key "model" rejected at factory init', () => {
    it('throws RILL-R001 listing "model" when extra contains model key', () => {
      expect(() =>
        createAnthropicExtension({ ...baseConfig, extra: { model: 'gpt-4' } })
      ).toThrow(/model/);
    });

    it('error message contains the reserved key name', () => {
      let message = '';
      try {
        createAnthropicExtension({ ...baseConfig, extra: { model: 'gpt-4' } });
      } catch (e: unknown) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("'model'");
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E7: Factory extra with temperature key → RILL-R001
  // ──────────────────────────────────────────────────────────
  describe('AC-E7: factory extra with reserved key "temperature" rejected at factory init', () => {
    it('throws RILL-R001 when extra contains temperature key', () => {
      expect(() =>
        createAnthropicExtension({ ...baseConfig, extra: { temperature: 0.5 } })
      ).toThrow(/temperature/);
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E9: tool_loop with max_turns: -1 → INVALID_INPUT
  // ──────────────────────────────────────────────────────────
  describe('AC-E9: tool_loop with negative max_turns per-call rejects with INVALID_INPUT', () => {
    it('rejects max_turns: -1 with INVALID_INPUT', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        my_tool: {
          __type: 'callable',
          kind: 'runtime',
          isProperty: false,
          fn: () => 'result',
        },
      };

      expectThrowHalt(
        () =>
          getCallable(ext, 'tool_loop').fn(
            { prompt: 'test', tools, max_turns: -1 },
            ctx
          ),
        { code: 'INVALID_INPUT' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E13: message(123) → INVALID_INPUT, raw.kind=invalid_prompt_type
  // ──────────────────────────────────────────────────────────
  describe('AC-E13: non-string non-list prompt rejected', () => {
    it('rejects numeric prompt with INVALID_INPUT (raw.kind: invalid_prompt_type)', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn({ prompt: 123 }, ctx),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'invalid_prompt_type' });
    });

    it('rejects object prompt with INVALID_INPUT', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn({ prompt: { text: 'hello' } }, ctx),
        { code: 'INVALID_INPUT' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E14: message([]) → INVALID_INPUT, raw.kind=empty_message_list
  // ──────────────────────────────────────────────────────────
  describe('AC-E14: empty message list rejected', () => {
    it('rejects empty array prompt with INVALID_INPUT (raw.kind: empty_message_list)', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn({ prompt: [] }, ctx),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'empty_message_list' });
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-E15: message("") → INVALID_INPUT, raw.kind=empty_prompt
  // ──────────────────────────────────────────────────────────
  describe('AC-E15: empty string prompt rejected', () => {
    it('rejects empty string with INVALID_INPUT (raw.kind: empty_prompt)', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn({ prompt: '' }, ctx),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'empty_prompt' });
    });

    it('rejects whitespace-only string with INVALID_INPUT (raw.kind: empty_prompt)', () => {
      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const thrown = expectThrowHalt(
        () =>
          getCallable(ext, 'message').fn({ prompt: '   ' }, ctx),
        { code: 'INVALID_INPUT' }
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw).toMatchObject({ kind: 'empty_prompt' });
    });
  });
});
