/**
 * Function behavior tests for message(), embed(), and embed_batch()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt } from './_halt-helpers.js';
import { createRuntimeContext } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { OpenAIExtensionConfig } from '../src/types.js';
import {
  createMockFinalCompletion,
  getCallable,
  resolveStream,
  type StreamCursor,
} from './_functions-helpers.js';

// ============================================================
// TEST HELPERS
// ============================================================

/** Minimal view of a rill vector value exercised by these tests. */
interface VectorResult {
  __rill_vector: boolean;
  model: string;
  data: Float32Array;
}

/**
 * Build a mock stream object compatible with client.chat.completions.stream().
 * Yields text deltas as ChatCompletionChunk-shaped objects, then
 * resolves finalChatCompletion() with the given final completion.
 */
function createMockStreamRunner(
  deltas: string[],
  finalCompletion: ChatCompletion
) {
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
  // A plain async iterator rather than a generator: this one never yields, so
  // as a generator it needed an unreachable `yield` purely to satisfy the
  // inferred type. Rejecting on the first next() is what "throws during
  // iteration" actually means.
  function asyncChunks(): AsyncIterator<unknown> {
    return { next: () => Promise.reject(error) };
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

  async function* asyncChunks(): AsyncGenerator<unknown> {
    if (partialContent.length > 0) {
      yield {
        choices: [
          { delta: { content: partialContent }, finish_reason: null, index: 0 },
        ],
        id: 'chatcmpl-partial',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'gpt-4-turbo',
      };
    }
    throw error;
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(partialCompletion),
    abort: vi.fn(),
  };
}
/**
 * Collect all string chunks from a RillStream by iterating via .next().
 */
async function collectStreamChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  let current = stream as StreamCursor;
  while (!current.done) {
    const nextField = current.next as { fn?: unknown };
    const fn = nextField.fn ?? current.next;
    const fnToCall = (
      typeof fn === 'function' ? fn : (fn as { fn: unknown }).fn
    ) as (a: object, b: object) => Promise<StreamCursor>;
    current = await fnToCall({}, {});
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }
  return chunks;
}

const ANY_ABORT_SIGNAL: unknown = expect.any(AbortSignal);

// Mock the OpenAI SDK at module level
const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: unknown,
      message: string,
      _headers: unknown
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
    // IR-1/AC-5: resolution dict has content, model, usage, stop_reason, id, messages
    it('resolves to dict with content, model, usage, stop_reason, id, messages', async () => {
      const runner = createMockStreamRunner(
        ['Hello ', 'from OpenAI!'],
        createMockFinalCompletion('Hello from OpenAI!')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
      const result = await resolveStream(stream);

      const messages = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      const lastMsg = messages.at(-1)!;
      const assistantText = lastMsg.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(assistantText).toBe('Hello from OpenAI!');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(result['id']).toBe('chatcmpl-test123');
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      });
      expect(messages[1]).toMatchObject({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello from OpenAI!' }],
      });
    });

    // IR-1/AC-3: iterating message() stream yields string chunks
    it('iterating stream yields string text deltas', async () => {
      const runner = createMockStreamRunner(
        ['Hello', ' from', ' OpenAI!'],
        createMockFinalCompletion('Hello from OpenAI!')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
      const chunks = await collectStreamChunks(stream);

      expect(chunks).toEqual(['Hello', ' from', ' OpenAI!']);
    });

    it('sends correct parameters to OpenAI streaming API without system prompt', async () => {
      const runner = createMockStreamRunner(
        [],
        createMockFinalCompletion('Response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'message').fn({ prompt: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        {
          model: 'gpt-4-turbo',
          max_completion_tokens: 4096,
          temperature: 0.7,
          stream_options: { include_usage: true },
          messages: [{ role: 'user', content: 'What is 2+2?' }],
        },
        { signal: ANY_ABORT_SIGNAL }
      );
    });

    it('sends system message as first message in OpenAI streaming format', async () => {
      const runner = createMockStreamRunner(
        [],
        createMockFinalCompletion('Response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'message').fn({ prompt: 'What is 2+2?' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        {
          model: 'gpt-4-turbo',
          max_completion_tokens: 4096,
          temperature: 0.7,
          stream_options: { include_usage: true },
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'What is 2+2?' },
          ],
        },
        { signal: ANY_ABORT_SIGNAL }
      );
    });

    it('uses factory config max_tokens when set', async () => {
      const runner = createMockStreamRunner(
        [],
        createMockFinalCompletion('Response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        max_tokens: 1000,
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 1000,
        }),
        { signal: ANY_ABORT_SIGNAL }
      );
    });
  });

  describe('error cases', () => {
    it.each([
      {
        label: '401 authentication',
        status: 401,
        apiMessage: 'Invalid API key',
        expected: 'OpenAI API error (HTTP 401): Invalid API key',
      },
      {
        label: '429 rate limit',
        status: 429,
        apiMessage: 'Rate limit',
        expected: 'OpenAI API error (HTTP 429): Rate limit',
      },
      {
        label: '500 generic API',
        status: 500,
        apiMessage: 'Internal server error',
        expected: 'OpenAI API error (HTTP 500): Internal server error',
      },
    ])(
      'throws RuntimeError for $label error during stream iteration',
      async ({ status, apiMessage, expected }) => {
        const { APIError } = await import('openai');
        const apiError = new APIError(status, {}, apiMessage, new Headers());
        mockStream.mockReturnValue(createErrorStreamRunner(apiError));

        const ext = createOpenAIExtension({
          api_key: 'test-key',
          model: 'gpt-4-turbo',
        });
        const ctx = createRuntimeContext();

        const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

        await expectRejectedHalt(collectStreamChunks(stream), {
          message: expected,
        });
      }
    );

    it('throws RuntimeError for timeout error during stream iteration', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'AbortError';
      mockStream.mockReturnValue(createErrorStreamRunner(timeoutError));

      const ext = createOpenAIExtension({
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      });
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), {
        message: 'OpenAI error: Request timeout',
      });
    });

    // EC-3/AC-16: Provider disconnect mid-stream throws during iteration; resolve returns partial data
    it('throws RuntimeError during iteration on mid-stream disconnect [EC-3]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(
        503,
        {},
        'Service unavailable',
        new Headers()
      );
      const runner = createPartialDisconnectRunner('Partial content', apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      await expectRejectedHalt(collectStreamChunks(stream), {
        message: 'OpenAI API error (HTTP 503): Service unavailable',
      });
    });

    it('resolves with partial data after mid-stream disconnect [AC-16]', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(
        503,
        {},
        'Service unavailable',
        new Headers()
      );
      const runner = createPartialDisconnectRunner(
        'Partial response text',
        apiError
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      // resolve() calls finalChatCompletion() which returns partial data even after disconnect
      const result = await resolveStream(stream);
      const msgs = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      const lastParts = msgs.at(-1)!.parts;
      const text = lastParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(text).toBe('Partial response text');
      expect(result['model']).toBe('gpt-4-turbo');
    });

    // Provider failure during resolution propagates as a halt with the mapped message
    it('resolve() rejects with the mapped provider error', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(
        500,
        {},
        'Internal server error',
        new Headers()
      );
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);

      await expectRejectedHalt(resolveStream(stream), {
        message: 'OpenAI API error (HTTP 500): Internal server error',
      });
    });
  });
});

// NOTE: messages() verb was removed in the unified prompting migration.
// Multi-turn message history is now passed via the prompt param of message().

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  describe('success cases', () => {
    // embed("text") returns a vector carrying the model and embedding length
    it.each([
      { dims: 1536, model: 'text-embedding-3-small' },
      { dims: 768, model: 'text-embedding-3-large' },
    ])(
      'returns vector with $dims dimensions for $model',
      async ({ dims, model }) => {
        const mockEmbedding = Array.from({ length: dims }, (_, i) => i * 0.001);
        mockEmbeddingsCreate.mockResolvedValue({
          data: [{ embedding: mockEmbedding }],
          model,
          usage: { prompt_tokens: 5, total_tokens: 5 },
        });

        const ext = createOpenAIExtension({
          api_key: 'test-key',
          model: 'gpt-4-turbo',
          embed_model: model,
        });
        const ctx = createRuntimeContext();

        const result = (await getCallable(ext, 'embed').fn(
          { text: 'test text' },
          ctx
        )) as VectorResult;

        expect(result.__rill_vector).toBe(true);
        expect(result.model).toBe(model);
        expect(result.data).toBeInstanceOf(Float32Array);
        expect(result.data.length).toBe(dims);
      }
    );
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

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: '' }, ctx),
        { message: 'embed text cannot be empty' }
      );
    });

    it('throws RuntimeError for whitespace-only text', async () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: '   \n\t  ' }, ctx),
        { message: 'embed text cannot be empty' }
      );
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

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'test' }, ctx),
        { message: 'embed_model not configured' }
      );
    });

    it('maps API authentication error (401)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(401, {}, 'Invalid API key', new Headers())
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'test' }, ctx),
        { message: 'OpenAI API error (HTTP 401): Invalid API key' }
      );
    });

    it('maps API rate limit error (429)', async () => {
      const MockAPIError = (await import('openai')).APIError;
      mockEmbeddingsCreate.mockRejectedValue(
        new MockAPIError(429, {}, 'Rate limit exceeded', new Headers())
      );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
        embed_model: 'text-embedding-3-small',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'test' }, ctx),
        { message: 'OpenAI API error (HTTP 429): Rate limit exceeded' }
      );
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
      const mockEmbedding1 = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      const mockEmbedding2 = Array.from({ length: 1536 }, (_, i) => i * 0.002);
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
      )) as VectorResult[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]!.__rill_vector).toBe(true);
      expect(result[1]!.__rill_vector).toBe(true);
      expect(result[0]!.model).toBe('text-embedding-3-small');
      expect(result[1]!.model).toBe('text-embedding-3-small');
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

      const result = (await getCallable(ext, 'embed_batch').fn(
        { texts: [] },
        ctx
      )) as VectorResult[];

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

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['test'] }, ctx),
        { message: 'embed_model not configured' }
      );
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
        getCallable(ext, 'embed_batch').fn(
          { texts: ['valid', 123, 'text'] },
          ctx
        ),
        { message: 'embed_batch requires list of strings' }
      );
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
        getCallable(ext, 'embed_batch').fn(
          { texts: ['valid', '', 'text'] },
          ctx
        ),
        { message: 'embed text cannot be empty at index 1' }
      );
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
        getCallable(ext, 'embed_batch').fn(
          { texts: ['valid', '   ', 'text'] },
          ctx
        ),
        { message: 'embed text cannot be empty at index 1' }
      );
    });
  });
});
