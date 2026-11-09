/**
 * Boundary tests for the Anthropic unified-prompting surface.
 *
 * Exercises edge cases and factory-time validation. Rejected-prompt and
 * reserved-key error cases are covered by the shared ext-llm contract tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeHaltSignal,
  getStatus,
  type ApplicationCallable,
} from '@rcrsr/rill';
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

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
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
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: content },
        };
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
        {
          role: 'system',
          parts: [{ type: 'text', text: 'You are a helpful assistant' }],
        },
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
  // AC-B8: repeated message() calls share factory extra and config
  //         without mutation
  // ──────────────────────────────────────────────────────────
  describe('AC-B8: repeated message() calls do not mutate shared factory extra', () => {
    it('leaves the factory extra object unchanged after 10 calls', async () => {
      mockStream.mockImplementation(() => createMockStream('ok'));

      const extra = { top_k: 5 };
      const ext = createAnthropicExtension({ ...baseConfig, extra });
      const ctx = createRuntimeContext();

      for (let i = 0; i < 10; i++) {
        await getCallable(ext, 'message').fn({ prompt: `Question ${i}` }, ctx);
      }

      expect(mockStream).toHaveBeenCalledTimes(10);
      expect(extra).toEqual({ top_k: 5 });
    });
  });
});
