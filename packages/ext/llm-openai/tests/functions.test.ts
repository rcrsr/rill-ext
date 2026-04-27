/**
 * Function behavior tests for message() and messages()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt } from './_halt-helpers.js';
import { createRuntimeContext, callable, type ApplicationCallable, type RillValue, type RillTypeValue, type TypeStructure } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Build a full ChatCompletion object matching OpenAI response shape.
 */
function createMockFinalCompletion(content: string, model = 'gpt-4-turbo') {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/**
 * Build a mock stream object compatible with client.chat.completions.stream().
 * Yields text deltas as ChatCompletionChunk-shaped objects, then
 * resolves finalChatCompletion() with the given final completion.
 */
function createMockStreamRunner(deltas: string[], finalCompletion: ReturnType<typeof createMockFinalCompletion>) {
  async function* asyncChunks() {
    for (const delta of deltas) {
      yield {
        choices: [{ delta: { content: delta }, finish_reason: null, index: 0 }],
        id: 'chatcmpl-test123',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: finalCompletion.model,
      };
    }
  }

  const runner = {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };

  return runner;
}

/**
 * Build a mock stream runner that throws during iteration.
 */
function createErrorStreamRunner(error: unknown) {
  async function* asyncChunks() {
    throw error;
    yield {} as any; // unreachable — needed for generator type
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockRejectedValue(error),
    abort: vi.fn(),
  };
}

/**
 * Build a mock stream runner that yields partial deltas then throws mid-stream.
 * The finalChatCompletion() still resolves with partial content to simulate EC-3 behavior.
 */
function createPartialDisconnectRunner(partialContent: string, error: unknown) {
  const partialCompletion = createMockFinalCompletion(partialContent);

  async function* asyncChunks() {
    if (partialContent.length > 0) {
      yield {
        choices: [{ delta: { content: partialContent }, finish_reason: null, index: 0 }],
        id: 'chatcmpl-partial',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4-turbo',
      };
    }
    throw error;
    yield {} as any; // unreachable — needed for generator type
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(partialCompletion),
    abort: vi.fn(),
  };
}

/**
 * Call the resolve callback on a RillStream returned from fn().
 * Uses the internal __rill_stream_resolve hidden property.
 */
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  const resolve = (stream as any).__rill_stream_resolve as () => Promise<unknown>;
  return (await resolve()) as Record<string, unknown>;
}

/**
 * Collect all string chunks from a RillStream by iterating via .next().
 */
async function collectStreamChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  let current = stream as any;
  while (!current.done) {
    const fn = (current.next as any).fn ?? (current.next as any);
    const fnToCall = typeof fn === 'function' ? fn : (fn as any).fn;
    current = await fnToCall({}, {});
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }
  return chunks;
}

/** Build a RillTypeValue from a TypeStructure for test usage. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return { __rill_type: true, typeName: structure.kind, structure } as unknown as RillTypeValue;
}

// Mock the OpenAI SDK at module level
const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: any,
      message: string,
      _headers: any
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      embeddings = {
        create: mockEmbeddingsCreate,
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
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('stream return (IR-1/AC-1)', () => {
    // IR-1/AC-1: message() returns RillStream
    it('returns a RillStream object', () => {
      const runner = createMockStreamRunner(['Hello'], createMockFinalCompletion('Hello from OpenAI!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

      // RillStream has __rill_stream discriminator
      expect((stream as any).__rill_stream).toBe(true);
      expect((stream as any).done).toBe(false);
      expect(typeof (stream as any).next).toBeDefined();
    });

    // IR-1/AC-5: resolution dict has content, model, usage, stop_reason, id, messages
    it('resolves to dict with content, model, usage, stop_reason, id, messages', async () => {
      const runner = createMockStreamRunner(['Hello ', 'from OpenAI!'], createMockFinalCompletion('Hello from OpenAI!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Hello from OpenAI!');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['id']).toBe('chatcmpl-test123');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello from OpenAI!' },
      ]);
    });

    // IR-1/AC-3: iterating message() stream yields string chunks
    it('iterating stream yields string text deltas', async () => {
      const runner = createMockStreamRunner(['Hello', ' from', ' OpenAI!'], createMockFinalCompletion('Hello from OpenAI!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
      const chunks = await collectStreamChunks(stream);

      expect(chunks).toEqual(['Hello', ' from', ' OpenAI!']);
    });

    it('sends correct parameters to OpenAI streaming API without system prompt', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        max_completion_tokens: 4096,
        temperature: 0.7,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
    });

    it('sends system message as first message in OpenAI streaming format', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
        max_completion_tokens: 4096,
        temperature: 0.7,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
      });
    });

    it('accepts options dict with system override', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'Default system.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test', options: { system: 'Override system.' } }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'Override system.' },
            { role: 'user', content: 'Test' },
          ],
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        max_tokens: 1000,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test', options: { max_tokens: 2000 } }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 2000,
        })
      );
    });

    it('uses default max_tokens when not specified', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 4096,
        })
      );
    });
  });

  describe('error cases', () => {
    // EC-1: Empty prompt text throws before stream creation
    it('throws RuntimeError for empty prompt text', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'message').fn({ text: '' }, ctx)).toThrow(
        'prompt text cannot be empty'
      );
    });

    it('throws RuntimeError for whitespace-only prompt text', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'message').fn({ text: '   ' }, ctx)).toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-2: Provider API error during stream — thrown when iterating chunks
    it('throws RuntimeError for 401 authentication error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(401, {}, 'Invalid API key', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 401): Invalid API key' });
    });

    it('throws RuntimeError for 429 rate limit error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(429, {}, 'Rate limit', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 429): Rate limit' });
    });

    it('throws RuntimeError for timeout error during stream iteration', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      const runner = createErrorStreamRunner(timeoutError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI error: Request timeout' });
    });

    it('throws RuntimeError for generic API error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(500, {}, 'Internal server error', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 500): Internal server error' });
    });

    // EC-3/AC-16: Provider disconnect mid-stream throws during iteration; resolve returns partial data
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(503, {}, 'Service unavailable', {});
      const runner = createPartialDisconnectRunner('Partial content', apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 503): Service unavailable' });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(503, {}, 'Service unavailable', {});
      const runner = createPartialDisconnectRunner('Partial response text', apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      // resolve() calls finalChatCompletion() which returns partial data even after disconnect
      const result = await resolveStream(stream);
      expect(result['content']).toBe('Partial response text');
      expect(result['model']).toBe('gpt-4-turbo');
    });

    // EC-12: Provider failure during resolution propagates as RuntimeError RILL-R005
    it('resolve() propagates provider error as RuntimeError RILL-R005 [EC-12]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(500, {}, 'Internal server error', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);

      await expect(resolveStream(stream));
    });
  });
});

// ============================================================
// MESSAGES() TESTS
// ============================================================

describe('messages() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('stream return (IR-1/AC-2)', () => {
    // IR-1/AC-2: messages() returns RillStream
    it('returns a RillStream object', () => {
      const runner = createMockStreamRunner(['Sure'], createMockFinalCompletion('Sure, I can help!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Can you help me?' }];

      const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);

      expect((stream as any).__rill_stream).toBe(true);
      expect((stream as any).done).toBe(false);
    });

    // IR-1/AC-4: iterating messages() stream yields string chunks
    it('iterating stream yields string text deltas', async () => {
      const runner = createMockStreamRunner(['Sure', ', I', ' can', ' help!'], createMockFinalCompletion('Sure, I can help!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Can you help me?' }];
      const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);
      const chunks = await collectStreamChunks(stream);

      expect(chunks).toEqual(['Sure', ', I', ' can', ' help!']);
    });

    // Resolution dict shape for messages()
    it('resolves to dict with conversation history', async () => {
      const runner = createMockStreamRunner(['Sure, I can help!'], createMockFinalCompletion('Sure, I can help!'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
      ];

      const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Sure, I can help!');
      expect(result['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Can you help me?' },
        { role: 'assistant', content: 'Sure, I can help!' },
      ]);
    });

    it('sends system message as first message in OpenAI streaming format', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'You are helpful.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Hello' }];
      getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );
    });

    it('accepts options dict with system override', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        system: 'Default system.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];
      getCallable(ext, 'messages').fn(
        { messages: inputMessages, options: { system: 'Override system.' } },
        ctx
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'Override system.' },
            { role: 'user', content: 'Test' },
          ],
        })
      );
    });

    it('accepts options dict with max_tokens override', async () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const inputMessages = [{ role: 'user', content: 'Test' }];
      getCallable(ext, 'messages').fn({ messages: inputMessages, options: { max_tokens: 2000 } }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 2000,
        })
      );
    });
  });

  describe('validation error cases', () => {
    // AC-23: Empty messages list raises error before stream creation
    it('throws RuntimeError for empty messages list', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'messages').fn({ messages: [] }, ctx)).toThrow(
        'messages list cannot be empty'
      );
    });

    // EC-10: Missing role field
    it('throws RuntimeError for message missing role field', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ content: 'Hello' }];

      expect(() => getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)).toThrow(
        "message missing required 'role' field"
      );
    });

    // EC-11: Invalid role value — thrown synchronously before stream creation
    it('throws RuntimeError for invalid role value', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'system', content: 'Hello' }];

      expect(() => getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)).toThrow(
        "invalid role 'system'"
      );
    });

    // EC-12: User message missing content — thrown synchronously
    it('throws RuntimeError for user message missing content', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'user' }];

      expect(() => getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)).toThrow(
        "user message requires 'content'"
      );
    });

    // EC-13: Assistant missing both content and tool_calls — thrown synchronously
    it('throws RuntimeError for assistant message missing content and tool_calls', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'assistant' }];

      expect(() => getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)).toThrow(
        "assistant message requires 'content' or 'tool_calls'"
      );
    });

    it('accepts assistant message with content — returns stream', () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const stream = getCallable(ext, 'messages').fn({ messages: validMessages }, ctx);
      expect((stream as any).__rill_stream).toBe(true);
    });

    it('accepts tool message with content — returns stream', () => {
      const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const validMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'Tool output' },
      ];

      const stream = getCallable(ext, 'messages').fn({ messages: validMessages }, ctx);
      expect((stream as any).__rill_stream).toBe(true);
    });

    it('throws RuntimeError for tool message missing content', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const invalidMessages = [{ role: 'tool' }];

      expect(() => getCallable(ext, 'messages').fn({ messages: invalidMessages }, ctx)).toThrow(
        "tool message requires 'content'"
      );
    });
  });

  describe('API error cases', () => {
    // EC-14: API errors apply to messages() too — thrown during stream iteration
    it('throws RuntimeError for 401 authentication error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(401, {}, 'Invalid API key', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 401): Invalid API key' });
    });

    it('throws RuntimeError for 429 rate limit error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(429, {}, 'Rate limit', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 429): Rate limit' });
    });

    it('throws RuntimeError for timeout error during stream iteration', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      const runner = createErrorStreamRunner(timeoutError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI error: Request timeout' });
    });

    it('throws RuntimeError for generic API error during stream iteration', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(500, {}, 'Internal server error', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 500): Internal server error' });
    });

    // EC-3/AC-16: Provider disconnect mid-stream for messages()
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(503, {}, 'Service unavailable', {});
      const runner = createPartialDisconnectRunner('Partial messages text', apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), { message: 'OpenAI API error (HTTP 503): Service unavailable' });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(503, {}, 'Service unavailable', {});
      const runner = createPartialDisconnectRunner('Partial multi-turn content', apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      const result = await resolveStream(stream);
      expect(result['content']).toBe('Partial multi-turn content');
      expect(result['model']).toBe('gpt-4-turbo');
    });

    // EC-12: Provider failure during resolution propagates as RuntimeError RILL-R005
    it('resolve() propagates provider error as RuntimeError RILL-R005 [EC-12]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(500, {}, 'Internal server error', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const messages = [{ role: 'user', content: 'Test' }];
      const stream = getCallable(ext, 'messages').fn({ messages }, ctx);

      await expect(resolveStream(stream));
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-4: embed("text") returns vector with model and dimensions
    it('returns vector with correct model and dimensions', async () => {
      const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed').fn({ text: 'test text' }, ctx)) as any;

      expect(result.__rill_vector).toBe(true);
      expect(result.model).toBe('text-embedding-3-small');
      expect(result.data).toBeInstanceOf(Float32Array);
      expect(result.data.length).toBe(1536);
    });

    it('handles different embedding dimensions', async () => {
      const mockEmbedding = new Array(768).fill(0).map((_, i) => i * 0.001);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
        model: 'text-embedding-3-large',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-large',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed').fn({ text: 'different size' }, ctx)) as any;

      expect(result.data.length).toBe(768);
    });
  });

  describe('error cases', () => {
    // EC-15: Empty text raises error
    it('throws RuntimeError for empty text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: '' }, ctx), { message: 'embed text cannot be empty' });
    });

    it('throws RuntimeError for whitespace-only text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: '   \n\t  ' }, ctx), { message: 'embed text cannot be empty' });
    });

    // EC-16: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        // No embed_model
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: 'test' }, ctx), { message: 'embed_model not configured' });
    });

    it('maps API authentication error (401)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(401, {}, 'Invalid API key', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: 'test' }, ctx), { message: 'OpenAI API error (HTTP 401): Invalid API key' });
    });

    it('maps API rate limit error (429)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(429, {}, 'Rate limit exceeded', {})
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed').fn({ text: 'test' }, ctx), { message: 'OpenAI API error (HTTP 429): Rate limit exceeded' });
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-5: embed_batch(["text1", "text2"]) returns list of vectors
    it('returns list of vectors for multiple texts', async () => {
      const mockEmbedding1 = new Array(1536).fill(0).map((_, i) => i * 0.001);
      const mockEmbedding2 = new Array(1536).fill(0).map((_, i) => i * 0.002);
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding1 }, { embedding: mockEmbedding2 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed_batch').fn(
        { texts: ['text1', 'text2'] },
        ctx
      )) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0].__rill_vector).toBe(true);
      expect(result[1].__rill_vector).toBe(true);
      expect(result[0].model).toBe('text-embedding-3-small');
      expect(result[1].model).toBe('text-embedding-3-small');
    });

    // AC-24: embed_batch([]) returns empty list
    it('returns empty list for empty input', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed_batch').fn({ texts: [] }, ctx)) as any[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('error cases', () => {
    // EC-17: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'embed_batch').fn({ texts: ['test'] }, ctx), { message: 'embed_model not configured' });
    });

    // EC-18: Non-string element in list
    it('throws RuntimeError for non-string element', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['valid', 123, 'text'] }, ctx)
      , { message: 'embed_batch requires list of strings' });
    });

    // EC-19: Empty string in list
    it('throws RuntimeError for empty string at index', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['valid', '', 'text'] }, ctx)
      , { message: 'embed text cannot be empty at index 1' });
    });

    it('throws RuntimeError for whitespace-only string at index', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['valid', '   ', 'text'] }, ctx)
      , { message: 'embed text cannot be empty at index 1' });
    });
  });
});

/**
 * Create an ApplicationCallable with description and param metadata for tool_loop tests.
 */
function makeTool(
  fn: (args: Record<string, RillValue>) => RillValue | Promise<RillValue>,
  options?: {
    description?: string;
    params?: Array<{ name: string; type: string; description?: string }>;
  }
): RillValue {
  const tool = callable(fn);
  if (options?.description !== undefined) {
    (tool as Record<string, unknown>)['description'] = options.description;
  }
  if (options?.params !== undefined) {
    (tool as Record<string, unknown>)['params'] = options.params.map((p) => ({
      name: p.name,
      type: { kind: p.type },
      defaultValue: undefined,
      annotations: p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

/**
 * Build a mock stream runner for tool_loop scenarios.
 * The runner emits content deltas then resolves finalChatCompletion().
 * The `on` method captures registered event handlers.
 */
function createMockToolLoopRunner(
  textDeltas: string[],
  finalCompletion: ReturnType<typeof createMockFinalCompletion>
) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  const runner = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]!.push(handler);
      return runner;
    }),
    finalChatCompletion: vi.fn(async () => {
      // Fire content events before resolving
      for (const delta of textDeltas) {
        for (const h of handlers['content'] ?? []) {
          h(delta, delta);
        }
      }
      return finalCompletion;
    }),
    abort: vi.fn(),
  };

  return runner;
}

/**
 * Collect all dict chunks from a tool_loop RillStream.
 */
async function collectDictChunks(stream: unknown): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  let current = stream as any;
  while (!current.done) {
    const fn = (current.next as any).fn ?? (current.next as any);
    const fnToCall = typeof fn === 'function' ? fn : (fn as any).fn;
    current = await fnToCall({}, {});
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as Record<string, unknown>);
    }
  }
  return chunks;
}

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  // ============================================================
  // STREAMING RETURN (AC-7, AC-8, AC-9)
  // ============================================================

  describe('stream return (AC-7/AC-8/AC-9)', () => {
    // AC-7: tool_loop() returns a RillStream value
    it('returns a RillStream object (isRillStream)', () => {
      const runner = createMockToolLoopRunner([], createMockFinalCompletion('Final response'));
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        test_tool: makeTool(vi.fn().mockResolvedValue('result'), { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test', tools, options: {} }, ctx);

      expect((stream as any).__rill_stream).toBe(true);
      expect((stream as any).done).toBe(false);
    });

    // AC-8: Iterating tool_loop stream yields text_delta, tool_call, tool_result dicts
    it('iterating stream yields text_delta, tool_call, and tool_result chunks', async () => {
      // First turn: tool call response
      const toolCallCompletion = {
        id: 'chatcmpl-test1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      // Second turn: final response
      const finalCompletion = createMockFinalCompletion('The weather is sunny');

      const runner1 = createMockToolLoopRunner(['Calling tool...'], toolCallCompletion);
      const runner2 = createMockToolLoopRunner(['The weather is sunny'], finalCompletion);

      mockStream
        .mockReturnValueOnce(runner1)
        .mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn().mockResolvedValue('Sunny, 72°F'), {
          description: 'Get weather',
          params: [{ name: 'location', type: 'string', description: 'City name' }],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools, options: {} },
        ctx
      );

      const chunks = await collectDictChunks(stream);

      // Should contain text_delta, tool_call, tool_result, then text_delta from second turn
      const textDeltas = chunks.filter((c) => c['type'] === 'text_delta');
      const toolCalls = chunks.filter((c) => c['type'] === 'tool_call');
      const toolResults = chunks.filter((c) => c['type'] === 'tool_result');

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(toolCalls.length).toBe(1);
      expect(toolResults.length).toBe(1);

      expect(toolCalls[0]).toMatchObject({ type: 'tool_call', name: 'get_weather' });
      expect(toolResults[0]).toMatchObject({ type: 'tool_result', name: 'get_weather' });
    });

    // AC-9: tool_loop()() resolution dict contains aggregated usage and turns
    it('resolve() returns dict with content, model, usage, stop_reason, turns, messages', async () => {
      const runner = createMockToolLoopRunner(
        ['Final response'],
        createMockFinalCompletion('Final response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        test_tool: makeTool(vi.fn().mockResolvedValue('result'), { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test prompt', tools, options: {} }, ctx);
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Final response');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['turns']).toBe(1);
      expect(Array.isArray(result['messages'])).toBe(true);
    });
  });

  describe('success cases', () => {
    // AC-9: tool_loop with tools returns dict with content, usage, turns
    it('resolve returns dict with content, model, usage, stop_reason, turns, messages', async () => {
      // Mock response without tool calls (final response)
      const runner = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: { role: 'assistant' as const, content: 'Final response' },
              finish_reason: 'stop' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('tool result');

      const tools = {
        test_tool: makeTool(mockToolFn, { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test prompt', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('Final response');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['turns']).toBe(1);
      expect(Array.isArray(result['messages'])).toBe(true);
    });

    // AC-25: tool_loop with max_turns:1 stops after 1 turn
    it('respects max_turns limit', async () => {
      // First call returns tool call (max_turns=1, loop exits after 1 turn)
      const runner = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        test_tool: makeTool(vi.fn().mockResolvedValue('tool result'), {
          description: 'A test tool',
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test prompt', tools, options: { max_turns: 1 } },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['turns']).toBe(1);
      expect(result['stop_reason']).toBe('max_turns');
    });

    // AC-26: tool_loop with 0 tool calls
    it('handles case with no tool calls', async () => {
      const runner = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: { role: 'assistant' as const, content: 'No tools needed' },
              finish_reason: 'stop' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        test_tool: makeTool(vi.fn(), { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test prompt', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('No tools needed');
      expect(result['turns']).toBe(1);
    });

    it('executes tool loop with tool calls', async () => {
      // First call: returns tool call response
      const runner1 = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test1',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"NYC"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }
      );

      // Second call: returns final response
      const runner2 = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test2',
          object: 'chat.completion' as const,
          created: 1234567891,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: 'The weather is sunny',
              },
              finish_reason: 'stop' as const,
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
          },
        }
      );

      mockStream
        .mockReturnValueOnce(runner1)
        .mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('Sunny, 72°F');

      const tools = {
        get_weather: makeTool(mockToolFn, {
          description: 'Get weather',
          params: [{ name: 'location', type: 'string', description: 'City name' }],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('The weather is sunny');
      expect(result['turns']).toBe(2);
      expect(result['usage']).toEqual({ input: 30, output: 15 });
      expect(mockToolFn).toHaveBeenCalledWith({ location: 'NYC' }, ctx);
    });

    it('strips SDK-injected properties from assistant messages before next request', async () => {
      // First call: response includes SDK-injected `parsed` and `refusal` fields
      const runner1 = createMockToolLoopRunner(
        [],
        {
          id: 'chatcmpl-test1',
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                parsed: { extracted: true },
                refusal: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"NYC"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }
      );

      // Second call: final response
      const runner2 = createMockToolLoopRunner(
        [],
        createMockFinalCompletion('The weather is sunny')
      );

      mockStream
        .mockReturnValueOnce(runner1)
        .mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn().mockResolvedValue('Sunny, 72°F'), {
          description: 'Get weather',
          params: [{ name: 'location', type: 'string', description: 'City name' }],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools, options: {} },
        ctx
      );
      await resolveStream(stream);

      // Inspect the messages sent in the second API call
      const secondCallArgs = mockStream.mock.calls[1]![0];
      const assistantMsg = secondCallArgs.messages.find(
        (m: Record<string, unknown>) => m['role'] === 'assistant'
      );

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg).not.toHaveProperty('parsed');
      expect(assistantMsg).not.toHaveProperty('refusal');
      expect(assistantMsg).toHaveProperty('role', 'assistant');
      expect(assistantMsg).toHaveProperty('tool_calls');
    });
  });

  describe('error cases', () => {
    // EC-20: Empty prompt — throws synchronously before stream creation
    it('throws RuntimeError for empty prompt', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      expect(() => getCallable(ext, 'tool_loop').fn({ prompt: '', tools: {}, options: {} }, ctx)).toThrow(
        'prompt text cannot be empty'
      );
    });

    // EC-21: Missing tools argument — thrown during stream iteration (executeToolLoop validates)
    it('throws RuntimeError when tools missing (during iteration)', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test', tools: undefined, options: {} }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'tools parameter is required' });
    });

    // EC-22: Unknown tool name — exceeds max_errors, throws from iteration
    // Note: Unknown tool errors are treated as tool execution errors
    // and count toward max_errors. With default max_errors=3 the loop
    // retries 3 times before throwing.
    it('throws RuntimeError for unknown tool after max_errors (during iteration)', async () => {
      function makeToolCallCompletion(id: string, callId: string) {
        return {
          id,
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: callId,
                    type: 'function' as const,
                    function: { name: 'unknown_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        };
      }

      mockStream
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-1', 'call_1')))
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-2', 'call_2')))
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-3', 'call_3')));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        known_tool: makeTool(vi.fn(), { description: 'A known tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test prompt', tools, options: {} }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Tool execution failed: 3 consecutive errors' });
    });

    // EC-4: Streaming API failure — resolve rejects with RILL-R005 and "Provider API error:" prefix
    it('resolve rejects with RILL-R005 on streaming API failure [EC-4]', async () => {
      mockStream.mockRejectedValue(new Error('API error'));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        tool: makeTool(vi.fn().mockResolvedValue('result'), { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test', tools, options: {} }, ctx);

      await expect(resolveStream(stream), { message: expect.stringContaining('Provider API error:') });
    });

    // AC-17: Tool execution error mid-loop yields tool_call chunk; stream resolves with final content
    it('tool_call chunk is yielded when tool errors; stream resolves with final content [AC-17]', async () => {
      // Turn 1: LLM calls a tool that will fail
      const toolCallCompletion = {
        id: 'chatcmpl-1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'flaky_tool', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      // Turn 2: LLM recovers and gives final text response
      const finalCompletion = createMockFinalCompletion('Recovered from tool error.');

      mockStream
        .mockReturnValueOnce(createMockToolLoopRunner([], toolCallCompletion))
        .mockReturnValueOnce(createMockToolLoopRunner(['Recovered from tool error.'], finalCompletion));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        flaky_tool: makeTool(
          vi.fn().mockRejectedValue(new Error('Transient failure')),
          { description: 'Flaky tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test', tools, options: { max_errors: 3 } },
        ctx
      );

      const chunks = await collectDictChunks(stream);

      // tool_call chunk is yielded for the failing tool
      const toolCallChunks = chunks.filter((c) => c['type'] === 'tool_call');
      expect(toolCallChunks.length).toBeGreaterThan(0);

      // Stream resolves with final content after tool error
      const result = await resolveStream(stream);
      expect(result['content']).toBe('Recovered from tool error.');
    });

    // EC-23: max_errors exceeded — thrown during stream iteration
    it('throws RuntimeError after max_errors consecutive failures (during iteration)', async () => {
      function makeToolCallCompletion(id: string, callId: string) {
        return {
          id,
          object: 'chat.completion' as const,
          created: 1234567890,
          model: 'gpt-4-turbo',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant' as const,
                content: null,
                tool_calls: [
                  {
                    id: callId,
                    type: 'function' as const,
                    function: { name: 'test_tool', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls' as const,
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      mockStream
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-1', 'call_1')))
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-2', 'call_2')))
        .mockReturnValueOnce(createMockToolLoopRunner([], makeToolCallCompletion('chatcmpl-3', 'call_3')));

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi
        .fn()
        .mockRejectedValue(new Error('Tool execution failed'));

      const tools = {
        test_tool: makeTool(mockToolFn, { description: 'A test tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'test prompt', tools, options: { max_errors: 3 } }, ctx);

      await expectRejectedHalt(resolveStream(stream), { message: 'Tool execution failed: 3 consecutive errors' });
    });
  });
});

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const baseConfig: OpenAIExtensionConfig = {
    api_key: 'test-key',
    model: 'gpt-4o',
  };

  function createGenerateMockResponse(jsonContent: string, model = 'gpt-4o') {
    return {
      id: 'chatcmpl-gen-test',
      object: 'chat.completion' as const,
      created: 1234567890,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant' as const, content: jsonContent },
          finish_reason: 'stop' as const,
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    };
  }

  describe('success cases', () => {
    // AC-6: returns dict with exactly 6 keys: data, raw, model, usage, stop_reason, id
    it('returns dict with data, raw, model, usage, stop_reason, id', async () => {
      const jsonContent = JSON.stringify({ name: 'Alice', age: 30 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: typeVal({ kind: 'dict', fields: { name: { type: { kind: 'string' } }, age: { type: { kind: 'number' } } } }), options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(Object.keys(result).sort()).toEqual(
        ['data', 'id', 'model', 'raw', 'stop_reason', 'usage'].sort()
      );
    });

    // AC-7: usage is {input: number, output: number}
    it('returns usage with input and output token counts', async () => {
      const jsonContent = JSON.stringify({ name: 'Bob' });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'describe a person', schema: typeVal({ kind: 'dict', fields: { name: { type: { kind: 'string' } } } }), options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['usage']).toEqual({ input: 15, output: 25 });
    });

    // AC-8: raw contains original JSON string
    it('returns raw as the original JSON string from response', async () => {
      const jsonContent = '{"name":"Charlie","score":99}';
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'score this', schema: typeVal({ kind: 'dict', fields: { name: { type: { kind: 'string' } }, score: { type: { kind: 'number' } } } }), options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonContent);
    });

    // AC-9: system option overrides factory default
    it('uses system option over factory default', async () => {
      const jsonContent = JSON.stringify({ ok: true });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension({
        ...baseConfig,
        system: 'factory system',
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { ok: { type: { kind: 'bool' } } } }), options: { system: 'override system' } },
        ctx
      );

      const callArgs = mockCreate.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toBe('override system');
    });

    // AC-10: max_tokens option caps output tokens
    it('passes max_tokens option to API call', async () => {
      const jsonContent = JSON.stringify({ result: 'ok' });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { result: { type: { kind: 'string' } } } }), options: { max_tokens: 128 } },
        ctx
      );

      const callArgs = mockCreate.mock.calls[0][0] as {
        max_completion_tokens: number;
      };
      expect(callArgs.max_completion_tokens).toBe(128);
    });

    // AC-11: messages option prepends context
    it('prepends messages before the prompt', async () => {
      const jsonContent = JSON.stringify({ answer: 42 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const prependedMessages = [
        { role: 'user', content: 'prior question' },
        { role: 'assistant', content: 'prior answer' },
      ];

      await getCallable(ext, 'generate').fn(
        { prompt: 'final prompt', schema: typeVal({ kind: 'dict', fields: { answer: { type: { kind: 'number' } } } }), options: { messages: prependedMessages } },
        ctx
      );

      const callArgs = mockCreate.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const nonSystemMessages = callArgs.messages.filter(
        (m) => m.role !== 'system'
      );
      expect(nonSystemMessages[0]).toEqual({
        role: 'user',
        content: 'prior question',
      });
      expect(nonSystemMessages[1]).toEqual({
        role: 'assistant',
        content: 'prior answer',
      });
      expect(nonSystemMessages[2]).toEqual({
        role: 'user',
        content: 'final prompt',
      });
    });

    // AC-12: absent system uses factory default
    it('uses factory system when no system option provided', async () => {
      const jsonContent = JSON.stringify({ val: 1 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension({
        ...baseConfig,
        system: 'factory default system',
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn({ prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { val: { type: { kind: 'number' } } } }), options: {} }, ctx);

      const callArgs = mockCreate.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toBe('factory default system');
    });

    // IR-5: response_format uses json_schema with strict: true
    it('sends response_format with type json_schema and strict true', async () => {
      const jsonContent = JSON.stringify({ x: 1 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn({ prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} }, ctx);

      const callArgs = mockCreate.mock.calls[0][0] as {
        response_format: {
          type: string;
          json_schema: { name: string; strict: boolean; schema: unknown };
        };
      };
      expect(callArgs.response_format.type).toBe('json_schema');
      expect(callArgs.response_format.json_schema.name).toBe('output');
      expect(callArgs.response_format.json_schema.strict).toBe(true);
    });

    // AC-33: success emits openai:generate with model, usage, duration
    it('emits openai:generate event on success', async () => {
      const jsonContent = JSON.stringify({ x: 1 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const events: Array<Record<string, unknown>> = [];
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await getCallable(ext, 'generate').fn({ prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} }, ctx);

      const generateEvent = events.find(
        (e) => e['event'] === 'openai:generate'
      );
      expect(generateEvent).toBeDefined();
      expect(generateEvent?.['model']).toBe('gpt-4o');
      expect(generateEvent?.['usage']).toEqual({ input: 15, output: 25 });
      expect(typeof generateEvent?.['duration']).toBe('number');
    });
  });

  describe('error cases', () => {
    // EC-3: missing schema throws RuntimeError RILL-R005
    it('throws RILL-R005 when schema option is missing', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx), { message: 'generate requires a type expression as schema' });
    });

    // EC-3: no HTTP call when schema is missing
    it('makes no API call when schema is missing', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // EC-4: unsupported type throws RILL-R005 via buildJsonSchema
    it('throws RILL-R005 for unsupported schema type', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { field: { type: { kind: 'unsupported_type' } } } }), options: {} },
          ctx
        )
      , { message: 'unsupported type: unsupported_type' });
    });

    // EC-5: JSON parse failure throws RILL-R005 with parse error detail
    it('throws RILL-R005 with parse error detail when response is not valid JSON', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('not valid json {{')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} }, ctx)
      , { message: 'generate: failed to parse response JSON:' });
    });

    // EC-6: provider API error mapped via mapProviderError
    it('maps OpenAI API errors to RuntimeError', async () => {
      mockCreate.mockRejectedValue(
        new (class extends Error {
          status = 429;
          name = 'APIError';
        })('Rate limit exceeded')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'prompt', schema: typeVal({ kind: 'dict', fields: { x: { type: { kind: 'number' } } } }), options: {} }, ctx)
      , { message: 'Rate limit exceeded' });
    });

    // AC-35: failure emits openai:error with error and duration
    it('emits openai:error event on failure', async () => {
      const events: Array<Record<string, unknown>> = [];
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expect(getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)).rejects.toThrow();

      const errorEvent = events.find((e) => e['event'] === 'openai:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['error']).toBe('string');
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });
});
