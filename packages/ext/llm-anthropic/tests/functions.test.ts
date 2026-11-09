/**
 * Function behavior tests for message()
 * Validates runtime behavior, error handling, and API integration.
 * The messages() verb was removed in the unified-prompting migration (task 2.1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import { expectRejectedHalt, expectThrowHalt } from './_halt-helpers.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Extract a named ApplicationCallable from an ExtensionFactoryResult value dict.
 */
function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
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
function createMockStream(
  content: string,
  model = 'claude-sonnet-4-5-20250929'
) {
  const response = createMockResponse(content, model);
  // Split content into two chunks to test multi-chunk iteration
  const chunks =
    content.length > 0
      ? [
          content.slice(0, Math.ceil(content.length / 2)),
          content.slice(Math.ceil(content.length / 2)),
        ]
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
function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  return (
    stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }
  ).__rill_stream_resolve();
}

function getStreamDispose(stream: unknown): () => void {
  return (stream as { __rill_stream_dispose: () => void })
    .__rill_stream_dispose;
}

interface StreamStep {
  readonly done?: boolean | undefined;
  readonly value?: unknown;
  readonly next?: {
    readonly fn: (
      args: Record<string, unknown>,
      ctx: null
    ) => Promise<StreamStep>;
  };
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected string chunks.
 */
async function collectChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  let current = stream as StreamStep;
  while (current.done !== true) {
    // next is a callable marker — invoke its fn directly
    current = await current.next!.fn({}, null);
    if (current.done !== true && current.value !== undefined) {
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
  return new APIError(status, {}, message, new Headers());
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
// HELPER: extract text from last assistant message in the result
// ============================================================

function extractLastAssistantText(result: Record<string, unknown>): string {
  const messages = result['messages'] as Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;
  const last = messages.at(-1)!;
  return last.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

// ============================================================
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  // IR-1/AC-1: message() returns RillStream
  describe('streaming', () => {
    // IR-1/AC-3: Iterating message() stream yields string text delta chunks
    it('yields string text delta chunks when iterated', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const result = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

      const chunks = await collectChunks(result);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => typeof c === 'string')).toBe(true);
      expect(chunks.join('')).toBe('Hello from Claude!');
    });

    // IR-1/AC-5: message()() resolution dict has model, usage, stop_reason, id, messages
    it('resolution dict has correct shape', async () => {
      mockStream.mockReturnValue(createMockStream('Hello from Claude!'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      // content field removed; text lives in messages[last].parts[i].text
      expect(extractLastAssistantText(result)).toBe('Hello from Claude!');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['id']).toBe('msg_test123');
      // messages is a list of canonical message dicts with role + parts
      const messages = result['messages'] as Array<{
        role: string;
        parts: unknown[];
      }>;
      expect(Array.isArray(messages)).toBe(true);
      expect(messages[0]!.role).toBe('user');
      expect(messages.at(-1)!.role).toBe('assistant');
      // content field removed from the resolution dict
      expect(Object.keys(result)).not.toContain('content');
    });
  });

  describe('success cases', () => {
    it('sends correct parameters to Anthropic stream API', async () => {
      mockStream.mockReturnValue(createMockStream('Response'));

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'message').fn({ prompt: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        {
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          temperature: 0.7,
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'What is 2+2?' }],
        },
        { signal: expect.any(AbortSignal) as AbortSignal }
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

      expectThrowHalt(
        () => getCallable(ext, 'message').fn({ prompt: '' }, ctx),
        {
          code: 'INVALID_INPUT',
          message: 'prompt string cannot be empty',
        }
      );
      expect(mockStream).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'HTTP 429',
        makeError: () => createMockAPIError(429, 'Rate limit exceeded'),
        code: 'RATE_LIMIT',
        message: 'Anthropic API error (HTTP 429): Rate limit exceeded',
      },
      {
        label: 'HTTP 401',
        makeError: () => createMockAPIError(401, 'Invalid API key'),
        code: 'AUTH',
        message: 'Anthropic API error (HTTP 401): Invalid API key',
      },
      {
        label: 'abort timeout',
        makeError: () =>
          Promise.resolve(
            Object.assign(new Error('Request timeout'), { name: 'AbortError' })
          ),
        code: 'TIMEOUT',
        message: 'Anthropic error: Request timeout',
      },
      {
        label: 'HTTP 500',
        makeError: () => createMockAPIError(500, 'Internal server error'),
        code: 'UNAVAILABLE',
        message: 'Anthropic API error (HTTP 500): Internal server error',
      },
      {
        label: 'unknown error',
        makeError: () => Promise.resolve({ unknown: 'error' }),
        code: 'UNAVAILABLE',
        message: 'Anthropic error: Unknown error',
      },
    ])(
      'maps $label from resolve() to #$code',
      async ({ makeError, code, message }) => {
        mockStream.mockReturnValue(createErrorStream(await makeError()));

        const ext = createAnthropicExtension({
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        });
        const ctx = createRuntimeContext();

        const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

        await expectRejectedHalt(resolveStream(stream), { code, message });
      }
    );

    // EC-3/AC-16: Provider disconnect mid-stream yields error during iteration; stream resolves with partial data
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(
        createPartialDisconnectStream('Partial response', mockError)
      );

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      // Iteration throws after yielding partial chunks
      await expectRejectedHalt(collectChunks(stream), { message: '503' });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const mockError = await createMockAPIError(503, 'Service unavailable');
      mockStream.mockReturnValue(
        createPartialDisconnectStream('Partial content', mockError)
      );

      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      // resolve() calls finalMessage() which returns partial response even after disconnect
      const result = await resolveStream(stream);
      expect(extractLastAssistantText(result)).toBe('Partial content');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
    });
  });
});

// messages() verb was removed in the unified-prompting migration (task 2.1).
// Multi-turn conversations now pass a list to message() via the prompt param.

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

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: '' }, ctx),
        { message: 'embed text cannot be empty' }
      );
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

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'test text' }, ctx),
        { message: 'embed_model not configured' }
      );
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

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'test text' }, ctx),
        { message: 'Anthropic: embeddings API not available' }
      );
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

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

      // The stream should immediately be done (0 chunks)
      const result = await resolveStream(stream);

      // Dict shape must be valid even with empty content
      // content field removed; text in messages[last].parts
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

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
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

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

      // The stream was created and has a dispose callback attached
      // Manually invoke the hidden dispose callback
      const disposeFn = getStreamDispose(stream);
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

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

      const disposeFn = getStreamDispose(stream);

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

      const result = await getCallable(ext, 'embed_batch').fn(
        { texts: [] },
        ctx
      );

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

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn(
          { texts: ['text1', 123, 'text3'] },
          ctx
        ),
        { message: 'embed_batch requires list of strings' }
      );
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
        getCallable(ext, 'embed_batch').fn(
          { texts: ['text1', '', 'text3'] },
          ctx
        ),
        { message: 'embed text cannot be empty at index 1' }
      );
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
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', 'text2'] }, ctx),
        { message: 'embed_model not configured' }
      );
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
        getCallable(ext, 'embed_batch').fn({ texts: ['text1', 'text2'] }, ctx),
        { message: 'Anthropic: embeddings API not available' }
      );
    });
  });
});
