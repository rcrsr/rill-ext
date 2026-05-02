/**
 * Wire-format tests for the Anthropic unified-prompting AC-* surface.
 *
 * These tests assert that canonical Message[] inputs are correctly translated
 * to Anthropic SDK MessageParam[] by inspecting the SDK call spy directly.
 *
 * Covered: AC-3, AC-11, AC-B5, tool_result placement (IC-29/IC-32)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';

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

/**
 * Build a mock SDK stream that resolves with a standard text response.
 * The chunks() generator inside message() iterates over the SDK stream's
 * Symbol.asyncIterator; finalMessage() returns the resolved dict.
 */
function createMockStreamForWire(content: string) {
  const response = {
    id: 'msg_wire_test',
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
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: content },
      };
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  };
}

/**
 * Build a mock SDK stream that resolves with a response containing a
 * RedactedThinkingBlock. Used to verify AC-B5 mapping.
 */
function createMockStreamWithRedactedThinking() {
  const response = {
    id: 'msg_thinking_test',
    type: 'message',
    role: 'assistant',
    content: [
      // RedactedThinkingBlock — SDK returns this type at runtime
      { type: 'redacted_thinking', data: 'encrypted_blob' },
      { type: 'text', text: 'Final answer.' },
    ],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 12 },
  };

  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Final answer.' },
      };
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  };
}

async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  return (stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }).__rill_stream_resolve();
}

// ============================================================
// WIRE-FORMAT TESTS
// ============================================================

describe('wire-format translation (canonical → Anthropic SDK params)', () => {
  const baseConfig: AnthropicExtensionConfig = {
    api_key: 'test-key',
    model: 'claude-sonnet-4-5-20250929',
    system: 'factory system',
  };

  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // ──────────────────────────────────────────────────────────
  // AC-3: System turn in message list overrides factory system
  // ──────────────────────────────────────────────────────────

  describe('AC-3: system turn lifted to top-level system param', () => {
    it('sends system text from canonical system turn, overriding factory system', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'system', parts: [{ type: 'text', text: 'You are X' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      expect(mockStream).toHaveBeenCalledOnce();
      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;

      // System role message was lifted to top-level system param
      expect(callArgs['system']).toBe('You are X');

      // System turn does NOT appear in messages array
      const messages = callArgs['messages'] as Array<{ role: string }>;
      expect(messages.every((m) => m.role !== 'system')).toBe(true);
    });

    it('factory system is used when no system turn is in the message list', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['system']).toBe('factory system');
    });

    it('system turn with multiple text parts concatenates text with newline', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'system',
          parts: [
            { type: 'text', text: 'Line one' },
            { type: 'text', text: 'Line two' },
          ],
        },
        { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['system']).toBe('Line one\nLine two');
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-11: Image part round-trip — base64 and url
  // ──────────────────────────────────────────────────────────

  describe('AC-11: image part mapping to Anthropic ImageBlockParam', () => {
    it('base64 image part → SDK ImageBlockParam with source.type: "base64"', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: {
                kind: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
                media_type: 'image/png',
              },
            },
          ],
        },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{
        role: string;
        content: Array<{ type: string; source?: { type: string; data?: string; media_type?: string } }>;
      }>;

      expect(messages).toHaveLength(1);
      const userMsg = messages[0]!;
      expect(userMsg.role).toBe('user');

      const content = userMsg.content;
      expect(Array.isArray(content)).toBe(true);

      const imageBlock = content.find((b) => b.type === 'image');
      expect(imageBlock).toBeDefined();
      expect(imageBlock!.source).toMatchObject({
        type: 'base64',
        media_type: 'image/png',
      });
    });

    it('url image part → SDK ImageBlockParam with source.type: "url"', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            {
              type: 'image',
              source: {
                kind: 'url',
                data: 'https://example.com/image.png',
                media_type: 'image/png',
              },
            },
          ],
        },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{
        role: string;
        content: Array<{ type: string; source?: { type: string; url?: string } }>;
      }>;

      const imageBlock = messages[0]!.content.find((b) => b.type === 'image');
      expect(imageBlock).toBeDefined();
      expect(imageBlock!.source).toMatchObject({
        type: 'url',
        url: 'https://example.com/image.png',
      });
    });
  });

  // ──────────────────────────────────────────────────────────
  // AC-B5: RedactedThinkingBlock → {type:'thinking', text:''}
  // ──────────────────────────────────────────────────────────

  describe('AC-B5: RedactedThinkingBlock maps to canonical thinking part with empty text', () => {
    it('resolves with thinking part having empty text for redacted_thinking block', async () => {
      mockStream.mockReturnValue(createMockStreamWithRedactedThinking());

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Explain your reasoning' }, ctx);
      const result = await resolveStream(stream);

      const messages = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text?: string }>;
      }>;

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();

      const thinkingPart = assistantMsg!.parts.find((p) => p.type === 'thinking');
      expect(thinkingPart).toBeDefined();
      // AC-B5: RedactedThinkingBlock → {type:'thinking', text:''}
      expect(thinkingPart!.text).toBe('');

      const textPart = assistantMsg!.parts.find((p) => p.type === 'text');
      expect(textPart).toBeDefined();
      expect(textPart!.text).toBe('Final answer.');
    });
  });

  // ──────────────────────────────────────────────────────────
  // tool_result placement: canonical tool_result part from a
  // user turn lands under user role as ToolResultBlockParam
  // ──────────────────────────────────────────────────────────

  describe('tool_result placement: user-turn tool_result lands under user role', () => {
    it('tool_result part in user turn maps to Anthropic ToolResultBlockParam under user role', () => {
      mockStream.mockReturnValue(createMockStreamForWire('Done'));

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      const prompt = [
        { role: 'user', parts: [{ type: 'text', text: 'What is the weather?' }] },
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'get_weather',
              input: { city: 'SF' },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              type: 'tool_result',
              id: 'tu_1',
              parts: [{ type: 'text', text: 'ok' }],
            },
          ],
        },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{
        role: string;
        content: Array<{ type: string; tool_use_id?: string; content?: string }> | string;
      }>;

      // The last message must be a user role
      const lastMsg = messages[messages.length - 1]!;
      expect(lastMsg.role).toBe('user');

      // Its content must contain a tool_result block
      const content = lastMsg.content;
      expect(Array.isArray(content)).toBe(true);
      const toolResultBlock = (content as Array<{ type: string; tool_use_id?: string; content?: string }>)
        .find((b) => b.type === 'tool_result');
      expect(toolResultBlock).toBeDefined();
      expect(toolResultBlock!.tool_use_id).toBe('tu_1');
      expect(toolResultBlock!.content).toBe('ok');
    });
  });

  // ──────────────────────────────────────────────────────────
  // User message content shorthand: single text part → string
  // ──────────────────────────────────────────────────────────

  describe('user message content optimization', () => {
    it('single text part in user message is sent as string shorthand', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{ role: string; content: unknown }>;

      // Simple string prompt should be sent as string content (not array)
      expect(messages[0]!.content).toBe('Hello');
    });

    it('multi-part user message is sent as content block array', () => {
      mockStream.mockReturnValue(createMockStreamForWire('OK'));

      const ext = createAnthropicExtension({ api_key: 'test-key', model: 'claude-sonnet-4-5-20250929' });
      const ctx = createRuntimeContext();

      const prompt = [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'Look at this image:' },
            {
              type: 'image',
              source: { kind: 'base64', data: 'abc123', media_type: 'image/png' },
            },
          ],
        },
      ];

      getCallable(ext, 'message').fn({ prompt }, ctx);

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<{ role: string; content: unknown }>;

      expect(Array.isArray(messages[0]!.content)).toBe(true);
    });
  });
});
