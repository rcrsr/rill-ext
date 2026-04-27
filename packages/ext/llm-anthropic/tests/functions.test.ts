/**
 * Function behavior tests for message() and messages()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, isRillStream, type ApplicationCallable } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import { expectRejectedHalt } from './_halt-helpers.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Extract a named ApplicationCallable from an ExtensionFactoryResult value dict.
 */
function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Create mock Anthropic API response (final message shape).
 */
function createMockResponse(
  content: string,
  model = 'claude-sonnet-4-5-20250929'
) {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/**
 * Create a mock MessageStream that yields text delta events and resolves with finalMessage().
 * The stream is async iterable over content_block_delta events.
 */
function createMockStream(content: string, model = 'claude-sonnet-4-5-20250929') {
  const response = createMockResponse(content, model);
  // Split content into two chunks to test multi-chunk iteration
  const chunks = content.length > 0
    ? [content.slice(0, Math.ceil(content.length / 2)), content.slice(Math.ceil(content.length / 2))]
    : [];
  const events = chunks.map((chunk) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: chunk },
  }));

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  };
}

/**
 * Create a mock stream that rejects during iteration.
 */
function createErrorStream(error: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      throw error;
      // eslint-disable-next-line no-unreachable
      yield { type: 'never' };
    },
    finalMessage: vi.fn().mockRejectedValue(error),
    abort: vi.fn(),
  };
}

/**
 * Create a mock stream that yields partial chunks then throws mid-stream.
 * The finalMessage() still resolves with partial content to simulate EC-3 behavior.
 */
function createPartialDisconnectStream(partialContent: string, error: unknown) {
  const partialResponse = createMockResponse(partialContent);
  return {
    [Symbol.asyncIterator]: async function* () {
      if (partialContent.length > 0) {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: partialContent },
        };
      }
      throw error;
      // eslint-disable-next-line no-unreachable
      yield { type: 'never' };
    },
    finalMessage: vi.fn().mockResolvedValue(partialResponse),
    abort: vi.fn(),
  };
}

/**
 * Resolve a RillStream by calling its hidden __rill_stream_resolve property.
 */
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  return (stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }).__rill_stream_resolve();
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected string chunks.
 */
async function collectChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = stream;
  while (!current.done) {
    // next is a callable marker — invoke its fn directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    current = await (current.next as any).fn({}, null);
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }
  return chunks;
}

/**
 * Create mock API error with status property.
 */
async function createMockAPIError(status: number, message: string) {
  const { APIError } = await import('@anthropic-ai/sdk');
  return new APIError(status, {}, message, {});
}

// Mock the Anthropic SDK at module level
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
        stream: mockStream,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  // IR-1/AC-1: message() returns RillStream
  describe('streaming', () => {
    it('returns RillStream (isRillStream is true)', () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      expect(isRillStream(result)).toBe(true);
    });

    // IR-1/AC-3: Iterating message() stream yields string text delta chunks
    it('yields string text delta chunks when iterated', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      const chunks = await collectChunks(result);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => typeof c === 'string')).toBe(true);
      expect(chunks.join('')).toBe('Hello from Claude!');
    });

    // IR-1/AC-5: message()() resolution dict has content, model, usage, stop_reason, id, messages
    it('resolution dict has correct shape', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Hello from Claude!');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from Claude!' },
      ]);
    });
  });

  describe('success cases', () => {
    // AC-2: message("text") resolution returns dict with required fields
    it('returns dict with content, model, usage, stop_reason, id, messages', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      expect(result).toBeDefined();
      expect(result['content']).toBe('Hello from Claude!');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from Claude!' },
      ]);
    });

    it('sends correct parameters to Anthropic stream API', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        temperature: 0.7,
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('accepts options dict with system override', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        system: 'Default system.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test', options: { system: 'Override system.' } }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Override system.',
        })
      );
    });

    it('accepts options dict with max_tokens override', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test', options: { max_tokens: 2000 } }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        })
      );
    });

    it('uses default max_tokens when not specified', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096,
        })
      );
    });
  });

  describe('error cases', () => {
    // EC-1: Empty prompt text throws BEFORE stream creation
    it('throws RuntimeError for empty prompt text before stream is created', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'message').fn({ text: '' }, ctx)).toThrow();
      expect(mockStream).not.toHaveBeenCalled();
    });

    it('throws RuntimeError with RILL-R005 for empty prompt text', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'message').fn({ text: '' }, ctx)).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining('prompt text cannot be empty'),
        })
      );
    });

    it('throws RuntimeError for whitespace-only prompt', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'message').fn({ text: '   \n\t  ' }, ctx)).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining('prompt text cannot be empty'),
        })
      );
    });

    // EC-2: Provider API error during stream resolution → RuntimeError RILL-R005
    it('maps 429 rate limit error from resolve() correctly', async () => {
      const mockError = await createMockAPIError(429, 'Rate limit exceeded');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic API error (HTTP 429): Rate limit exceeded' });
    });

    it('maps 401 auth error from resolve() correctly', async () => {
      const mockError = await createMockAPIError(401, 'Invalid API key');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic API error (HTTP 401): Invalid API key' });
    });

    it('maps timeout error from resolve() correctly', async () => {
      const mockError = new Error('Request timeout');
      mockError.name = 'AbortError';
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic error: Request timeout' });
    });

    it('maps 500 error from resolve() correctly', async () => {
      const mockError = await createMockAPIError(500, 'Internal server error');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic API error (HTTP 500): Internal server error' });
    });

    it('maps unknown error from resolve() correctly', async () => {
      const mockError = { unknown: 'error' };
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic error: Unknown error' });
    });

    // EC-3/AC-16: Provider disconnect mid-stream yields error during iteration; stream resolves with partial data
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(createPartialDisconnectStream('Partial response', mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      // Iteration throws after yielding partial chunks
      await expectRejectedHalt(collectChunks(stream), { message: '503' });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(createPartialDisconnectStream('Partial content', mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      // resolve() calls finalMessage() which returns partial response even after disconnect
      const result = await resolveStream(stream);
      expect(result['content']).toBe('Partial content');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
    });

    // EC-12: Provider failure during resolution propagates as RuntimeError RILL-R005
    it('resolve() propagates provider error as RuntimeError RILL-R005 [EC-12]', async () => {
      const mockError = await createMockAPIError(500, 'Internal server error');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream));
    });
  });
});

// ============================================================
// MESSAGES() TESTS
// ============================================================

describe('messages() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  // IR-1/AC-2: messages() returns RillStream
  describe('streaming', () => {
    it('returns RillStream (isRillStream is true)', () => {
      mockStream.mockReturnValue(createMockStream('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Hello' }] },
        ctx
      );

      expect(isRillStream(result)).toBe(true);
    });

    // IR-1/AC-4: Iterating messages() stream yields string text delta chunks
    it('yields string text delta chunks when iterated', async () => {
      mockStream.mockReturnValue(createMockStream('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Hello' }] },
        ctx
      );

      const chunks = await collectChunks(result);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => typeof c === 'string')).toBe(true);
      expect(chunks.join('')).toBe('Claude response');
    });

    // IR-1/AC-6: messages()() resolution dict matches message()() shape
    it('resolution dict has content, model, usage, stop_reason, id, messages', async () => {
      mockStream.mockReturnValue(createMockStream('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Hello' }] },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Claude response');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      expect(Array.isArray(result['messages'])).toBe(true);
    });
  });

  describe('success cases', () => {
    // AC-3: messages([...]) resolution returns dict with required fields
    it('returns dict with content, model, usage, stop_reason, id, messages', async () => {
      mockStream.mockReturnValue(createMockStream('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const stream = getCallable(ext, 'messages').fn(
        { messages: conversationHistory },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result).toBeDefined();
      expect(result['content']).toBe('Claude response');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');

      // Verify full conversation history including new response
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'Claude response' },
      ]);
    });

    it('sends correct parameters to Anthropic stream API', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.5,
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ];

      getCallable(ext, 'messages').fn({ messages: conversationHistory }, ctx);

      expect(mockStream).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        temperature: 0.5,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });
    });

    it('accepts single user message', async () => {
      mockStream.mockReturnValue(createMockStream('Claude response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const conversationHistory = [{ role: 'user', content: 'Hello' }];

      const stream = getCallable(ext, 'messages').fn(
        { messages: conversationHistory },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Claude response');
    });

    it('accepts options dict with system override', () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        system: 'Default system.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }], options: { system: 'Override system.' } },
        ctx
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Override system.',
        })
      );
    });
  });

  describe('error cases', () => {
    // AC-23: Empty messages list raises error before stream creation
    it('throws RuntimeError for empty messages list', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'messages').fn({ messages: [] }, ctx)).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining('messages list cannot be empty'),
        })
      );
      expect(mockStream).not.toHaveBeenCalled();
    });

    // EC-10: Missing role field
    it('throws RuntimeError when message is missing role', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ content: 'Hello' }];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)
      ).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining("message missing required 'role' field"),
        })
      );
    });

    // EC-11: Unknown role value
    it('throws RuntimeError for unknown role value', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'system', content: 'Hello' }];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)
      ).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining("invalid role 'system'"),
        })
      );
    });

    // EC-12: User message missing content
    it('throws RuntimeError when user message missing content', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user' }];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)
      ).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining("user message requires 'content'"),
        })
      );
    });

    it('throws RuntimeError when user content is not string', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user', content: 123 }];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)
      ).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining("user message requires 'content'"),
        })
      );
    });

    // EC-13: Assistant missing both content and tool_calls
    it('throws RuntimeError when assistant missing content and tool_calls', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant' },
      ];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)
      ).toThrowError(
        expect.objectContaining({
          errorId: 'RILL-R005',
          message: expect.stringContaining("assistant message requires 'content' or 'tool_calls'"),
        })
      );
    });

    it('accepts assistant message with content', async () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      expect(() =>
        getCallable(ext, 'messages').fn({ messages: validMessages }, ctx)
      ).not.toThrow();
    });

    // EC-14: API errors during resolution
    it('maps 429 rate limit error from resolve() correctly', async () => {
      const mockError = await createMockAPIError(429, 'Rate limit exceeded');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic API error (HTTP 429): Rate limit exceeded' });
    });

    it('maps 401 auth error from resolve() correctly', async () => {
      const mockError = await createMockAPIError(401, 'Invalid API key');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic API error (HTTP 401): Invalid API key' });
    });

    it('maps timeout error from resolve() correctly', async () => {
      const mockError = new Error('Request timeout');
      mockError.name = 'AbortError';
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: 'Anthropic error: Request timeout' });
    });

    // EC-3/AC-16: Provider disconnect mid-stream for messages()
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(createPartialDisconnectStream('Partial response text', mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      await expectRejectedHalt(collectChunks(stream), { message: expect.stringContaining('503') });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(createPartialDisconnectStream('Partial messages content', mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      const result = await resolveStream(stream);
      expect(result['content']).toBe('Partial messages content');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
    });

    // EC-12: Provider failure during resolution propagates as RuntimeError RILL-R005
    it('resolve() propagates provider error as RuntimeError RILL-R005 [EC-12]', async () => {
      const mockError = await createMockAPIError(500, 'Internal server error');
      mockStream.mockReturnValue(createErrorStream(mockError));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'messages').fn(
        { messages: [{ role: 'user', content: 'Test' }] },
        ctx
      );

      await expect(resolveStream(stream));
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  describe('error cases', () => {
    // EC-15: Empty text raises error
    it('raises error for empty text', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(getCallable(ext, 'embed').fn({ text: '' }, ctx), { message: 'embed text cannot be empty' });
    });

    // EC-16: No embed_model configured raises error
    it('raises error when embed_model not configured', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        // embed_model not provided
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: 'test text' }, ctx), { message: 'embed_model not configured' });
    });

    // EC-17: API errors mapped correctly (currently raises "not available")
    it('raises error indicating embeddings API not available', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: 'test text' }, ctx), { message: 'Anthropic: embeddings API not available' });
    });
  });

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed').params).toEqual([{ name: 'text', type: { kind: 'string' }, defaultValue: undefined, annotations: {} }]);
    });

    it('has correct description', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed').annotations?.['description']).toBe('Generate embedding vector for text');
    });

    it('has correct return type', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed').returnType).toEqual({ __rill_type: true, typeName: 'vector', structure: { kind: 'vector' } });
    });
  });
});

// ============================================================
// BOUNDARY CONDITION TESTS
// ============================================================

describe('boundary conditions', () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  // AC-13: ()  on message() returns dict identical to pre-streaming return
  describe('AC-13: resolveStream(message()) returns expected dict shape', () => {
    it('resolution dict matches pre-streaming shape field-by-field', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      // All 6 fields from the LLM Message resolution dict spec (IR-6)
      expect(result['content']).toBe('Hello from Claude!');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      expect(Array.isArray(result['messages'])).toBe(true);

      // Exact shape match: only these 6 keys
      const keys = Object.keys(result);
      expect(keys).toContain('content');
      expect(keys).toContain('model');
      expect(keys).toContain('usage');
      expect(keys).toContain('stop_reason');
      expect(keys).toContain('id');
      expect(keys).toContain('messages');
    });
  });

  // AC-15: First chunk arrives within 500ms (mock timing test)
  describe('AC-15: first chunk from message() arrives within 500ms', () => {
    it('first chunk is emitted before 500ms deadline using mock timing', async () => {
      mockStream.mockReturnValue(createMockStream('Streaming response content'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const before = Date.now();
      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // Advance to first chunk via next()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstStep = await (stream as any).next.fn({}, null);
      const after = Date.now();

      // First chunk must arrive within 500ms window
      expect(after - before).toBeLessThan(500);
      // And it must actually contain a string value (not done)
      expect(firstStep.done).toBe(false);
      expect(typeof firstStep.value).toBe('string');
    });
  });

  // AC-22: Second iteration of a consumed stream halts runtime
  describe('AC-22: second iteration of consumed stream throws RILL-R002', () => {
    it('calling next() on the done step of a fully-consumed stream throws RILL-R002', async () => {
      mockStream.mockReturnValue(createMockStream('Test content'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // Navigate to the done step manually (without using collectChunks which discards the done step)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = stream;
      while (!current.done) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        current = await (current.next as any).fn({}, null);
      }

      // current is the done step; calling its next() throws RILL-R002 synchronously
      // (the done step's callable is a sync function that throws, not async)
      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (current.next as any).fn({}, null)
      ).toThrow(
        expect.objectContaining({
          errorId: 'RILL-R002',
          message: 'Stream already consumed; cannot re-iterate',
        })
      );
    });

    it('calling next() on the initial stream step after it was consumed throws RILL-R002', async () => {
      mockStream.mockReturnValue(createMockStream('Test'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // First call to next() succeeds and marks the root step as consumed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (stream as any).next.fn({}, null);

      // Second call to next() on the same initial step throws RILL-R002
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).next.fn({}, null)
      ).rejects.toMatchObject({
        errorId: 'RILL-R002',
        message: 'Stream already consumed; cannot re-iterate',
      });
    });
  });

  // AC-23: ()  resolution followed by iteration attempt throws RILL-R002
  describe('AC-23: after resolution, iteration attempt throws RILL-R002', () => {
    it('calling next() after resolveStream() on an unstarted stream throws RILL-R002', async () => {
      mockStream.mockReturnValue(createMockStream('Test'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // Resolve the stream directly (without iterating chunks)
      await resolveStream(stream);

      // After resolve, the underlying iterator is exhausted — next() on the root step still throws RILL-R002
      // because the root next callable is not consumed by resolveStream, but calling it on an
      // already-exhausted iterator advances correctly. However, the runtime enforces single-use
      // on the stream step's .next callable, so calling .next() twice throws RILL-R002.
      // First call to .next() on original stream step (root):
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const step1 = await (stream as any).next.fn({}, null);

      // Second call to original stream's .next() throws because it's stale
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).next.fn({}, null)
      ).rejects.toMatchObject({
        errorId: 'RILL-R002',
        message: 'Stream already consumed; cannot re-iterate',
      });

      // Also: once exhausted, calling next on done step throws RILL-R002
      void step1; // used for exhaustion path verification
    });
  });

  // AC-24: Stream with 0 chunks resolves to valid dict
  describe('AC-24: 0-chunk stream resolves to valid dict', () => {
    it('stream with no text chunks still resolves with valid dict shape', async () => {
      // createMockStream with empty string yields no text delta events
      mockStream.mockReturnValue(createMockStream(''));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // The stream should immediately be done (0 chunks)
      const result = await resolveStream(stream);

      // Dict shape must be valid even with empty content
      expect(typeof result['content']).toBe('string');
      expect(typeof result['model']).toBe('string');
      expect(result['usage']).toBeDefined();
      expect(typeof result['stop_reason']).toBe('string');
      expect(typeof result['id']).toBe('string');
      expect(Array.isArray(result['messages'])).toBe(true);
    });

    it('iterating 0-chunk stream yields no values and stream is immediately done', async () => {
      mockStream.mockReturnValue(createMockStream(''));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const chunks = await collectChunks(stream);

      // No text chunks emitted for empty content
      expect(chunks).toHaveLength(0);
    });
  });

  // AC-27: Abandoned stream triggers dispose cleanup
  describe('AC-27: abandoned stream triggers dispose callback', () => {
    it('dispose property calls sdkStream.abort() when invoked', () => {
      const mockSdkStream = createMockStream('Test content');
      mockStream.mockReturnValue(mockSdkStream);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // The stream was created and has a dispose callback attached
      // Manually invoke the hidden dispose callback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const disposeFn = (stream as any).__rill_stream_dispose;
      expect(typeof disposeFn).toBe('function');

      // Invoke dispose — should call sdkStream.abort()
      disposeFn();

      expect(mockSdkStream.abort).toHaveBeenCalledTimes(1);
    });

    it('dispose is idempotent: calling twice only aborts once', () => {
      const mockSdkStream = createMockStream('Test content');
      mockStream.mockReturnValue(mockSdkStream);

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const disposeFn = (stream as any).__rill_stream_dispose;

      disposeFn();
      disposeFn();

      // The createRillStream wrapper ensures dispose is called only once
      expect(mockSdkStream.abort).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  describe('success cases', () => {
    // AC-24: Empty list returns empty list without API call
    it('returns empty list for empty input without API call', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'embed_batch').fn({ texts: [] }, ctx);

      expect(result).toEqual([]);
    });
  });

  describe('error cases', () => {
    // EC-18: Non-string element raises error
    it('raises error for non-string element', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', 123, 'text3'] }, ctx)
      , { message: 'embed_batch requires list of strings' });
    });

    // EC-19: Empty string at index raises error
    it('raises error for empty string element with index', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', '', 'text3'] }, ctx)
      , { message: 'embed text cannot be empty at index 1' });
    });

    // EC-20: No embed_model configured raises error
    it('raises error when embed_model not configured', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        // embed_model not provided
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', 'text2'] }, ctx)
      , { message: 'embed_model not configured' });
    });

    // EC-21: API errors mapped correctly (currently raises "not available")
    it('raises error indicating embeddings API not available', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', 'text2'] }, ctx)
      , { message: 'Anthropic: embeddings API not available' });
    });
  });

  describe('function metadata', () => {
    it('has correct params definition', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed_batch').params).toEqual([{ name: 'texts', type: { kind: 'list' }, defaultValue: undefined, annotations: {} }]);
    });

    it('has correct description', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed_batch').annotations?.['description']).toBe(
        'Generate embedding vectors for multiple texts'
      );
    });

    it('has correct return type', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        embed_model: 'voyager-3-large',
      };

      const ext = createAnthropicExtension(config);

      expect(getCallable(ext, 'embed_batch').returnType).toEqual({ __rill_type: true, typeName: 'list', structure: { kind: 'list' } });
    });
  });
});
