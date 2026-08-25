/**
 * Function behavior tests for message() and embed/embed_batch/tool_loop()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectHalt, expectRejectedHalt } from './_halt-helpers.js';
import {
  createRuntimeContext,
  callable,
  isRillStream,
  isInvalid,
  getStatus,
  type ApplicationCallable,
  type RillStream,
  type RillValue,
} from '@rcrsr/rill';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Extract text content from the last message in a resolved messages list.
 * The new surface returns { messages: [{role, parts: [{type, text}]}] }
 * instead of { content: string }.
 */
function extractLastMessageText(resolved: Record<string, unknown>): string {
  const messages = resolved['messages'] as Array<{
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;
  const last = messages[messages.length - 1];
  if (!last) return '';
  return last.parts
    .filter((p) => p.type === 'text' && p.text !== undefined)
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * Build an async iterable that yields chunks from an array of text strings.
 * Simulates the Gemini streaming response format.
 */
async function* makeChunksIterable(
  chunks: string[]
): AsyncGenerator<{ text: string }> {
  for (const text of chunks) {
    yield { text };
  }
}

/**
 * Build an async iterable that yields partial chunks then throws mid-stream.
 * Used to simulate EC-3 (provider disconnect mid-stream) behavior.
 */
async function* makePartialDisconnectIterable(
  partialChunks: string[],
  error: unknown
): AsyncGenerator<{ text: string }> {
  for (const text of partialChunks) {
    yield { text };
  }
  throw error;
}

/**
 * Exhaust a RillStream by calling next() until done, then invoke resolve.
 * Returns collected chunks and the resolved dict value.
 */
async function collectStream(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<{ chunks: string[]; resolved: Record<string, unknown> }> {
  const chunks: string[] = [];
  let current = stream as RillStream;

  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }

  // Call the hidden resolve function to get the dict result
  const resolved = await (
    stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
  ).__rill_stream_resolve();
  return { chunks, resolved: resolved as Record<string, unknown> };
}

/**
 * Collect partial chunks from a RillStream until an error is thrown.
 * Returns the chunks collected before the error and the caught error.
 */
async function collectStreamUntilError(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<{ chunks: string[]; error: unknown }> {
  const chunks: string[] = [];
  let current = stream as RillStream;

  try {
    while (!current.done) {
      const nextFn = current.next as ApplicationCallable;
      current = (await nextFn.fn({}, ctx)) as RillStream;
      if (!current.done && current.value !== undefined) {
        chunks.push(current.value as string);
      }
    }
    return { chunks, error: null };
  } catch (error: unknown) {
    return { chunks, error };
  }
}

// Mock the Google GenAI SDK at module level
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockEmbedContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
        embedContent: mockEmbedContent,
      };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
    },
  };
});

// ============================================================
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  describe('success cases', () => {
    // AC-2: message("prompt") returns RillStream that resolves to dict with required fields
    it('returns RillStream', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Hello', ' from', ' Google!'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        ctx
      );

      expect(isRillStream(stream)).toBe(true);
    });

    // AC-3: Iterating message() stream yields string chunks
    it('iterating stream yields string text chunks', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Hello', ' from', ' Google!'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        ctx
      );
      const { chunks } = await collectStream(stream, ctx);

      expect(chunks).toEqual(['Hello', ' from', ' Google!']);
    });

    // AC-5: message() resolve dict has messages, model, usage, stop_reason, id
    it('resolved dict has messages, model, usage, stop_reason, id', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Hello from Google!'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        ctx
      );
      const { resolved } = await collectStream(stream, ctx);

      expect(extractLastMessageText(resolved)).toBe('Hello from Google!');
      expect(resolved['model']).toBe('gemini-2.0-flash');
      expect(resolved['usage']).toEqual({ input: 0, output: 0 });
      expect(resolved['stop_reason']).toBe('stop');
      expect(resolved['id']).toBe('');
      // messages is a parts-shaped list: last entry is assistant reply
      const messages = resolved['messages'] as Array<{
        role: string;
        parts: unknown[];
      }>;
      expect(Array.isArray(messages)).toBe(true);
      const last = messages[messages.length - 1]!;
      expect(last.role).toBe('assistant');
    });

    it('sends correct parameters to Google streaming API without system prompt', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Response'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        temperature: 0.7,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'What is 2+2?' },
        ctx
      );
      await collectStream(stream, ctx);

      expect(mockGenerateContentStream).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'What is 2+2?' }],
          },
        ],
        config: expect.objectContaining({
          maxOutputTokens: 8192,
          temperature: 0.7,
        }),
      });
    });

    it('sends system instruction via config parameter', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Response'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        temperature: 0.7,
        system: 'You are helpful.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'What is 2+2?' },
        ctx
      );
      await collectStream(stream, ctx);

      expect(mockGenerateContentStream).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: 'What is 2+2?' }],
          },
        ],
        config: expect.objectContaining({
          systemInstruction: 'You are helpful.',
          maxOutputTokens: 8192,
          temperature: 0.7,
        }),
      });
    });

    it('uses default max_tokens when not specified', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Response'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      await collectStream(stream, ctx);

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            maxOutputTokens: 8192,
          }),
        })
      );
    });

    it('includes user message and assistant reply in resolved messages', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Response'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        system: 'You are helpful.',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      const { resolved } = await collectStream(stream, ctx);

      const messages = resolved['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text?: string }>;
      }>;
      // system → user → assistant
      expect(messages.length).toBeGreaterThanOrEqual(2);
      const lastMsg = messages[messages.length - 1]!;
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.parts[0]?.text).toBe('Response');
    });

    it('sends multi-turn messages when prompt is a list', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeChunksIterable(['Response'])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      // Prompt as a list of messages (multi-turn path via normalizePrompt)
      const inputMessages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const stream = await getCallable(ext, 'message').fn(
        { prompt: inputMessages },
        ctx
      );
      await collectStream(stream, ctx);

      // Wire: assistant → model rename happens only in vendor format
      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            { role: 'user', parts: [{ text: 'Hello' }] },
            { role: 'model', parts: [{ text: 'Hi there!' }] },
            { role: 'user', parts: [{ text: 'How are you?' }] },
          ],
        })
      );
    });
  });

  describe('error cases', () => {
    // EC-1: Empty prompt text — normalizePrompt returns invalid RillValue (not a reject)
    it('returns invalid RillValue for empty prompt text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'message').fn({ prompt: '' }, ctx);
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toContain(
        'prompt string cannot be empty'
      );
    });

    it('returns invalid RillValue for whitespace-only prompt text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'message').fn(
        { prompt: '   ' },
        ctx
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toContain(
        'prompt string cannot be empty'
      );
    });

    // EC-2: Provider API error during stream
    it('throws RuntimeError for 401 authentication error when iterating stream', async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error('authentication failed (401)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'invalid-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      await expectRejectedHalt(collectStream(stream, ctx), {
        message: 'Gemini API error (HTTP 401): authentication failed (401)',
      });
    });

    // EC-2: Provider API error during stream
    it('throws RuntimeError for 429 rate limit error when iterating stream', async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error('rate limit exceeded')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      await expectRejectedHalt(collectStream(stream, ctx), {
        message: 'Gemini API error: rate limit exceeded',
      });
    });

    // EC-2: Network timeout error during stream
    it('throws RuntimeError for timeout error when iterating stream', async () => {
      mockGenerateContentStream.mockRejectedValue(new Error('Request timeout'));

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      await expectRejectedHalt(collectStream(stream, ctx), {
        message: 'Gemini API error: Request timeout',
      });
    });

    // EC-2: Generic API error with status during stream
    it('throws RuntimeError for generic API error when iterating stream', async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error('Internal server error (500)')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );
      await expectRejectedHalt(collectStream(stream, ctx), {
        message: 'Gemini API error (HTTP 500): Internal server error (500)',
      });
    });

    // EC-3/AC-16: Provider disconnect mid-stream — error thrown during iteration
    it('throws during iteration on mid-stream disconnect [EC-3]', async () => {
      const disconnectError = new Error('Connection reset (503)');
      mockGenerateContentStream.mockResolvedValue(
        makePartialDisconnectIterable(['Partial text'], disconnectError)
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );

      const { error } = await collectStreamUntilError(stream, ctx);
      expectHalt(error, { message: 'Gemini API error' });
    });

    it('yields partial chunks before mid-stream disconnect [EC-3]', async () => {
      const disconnectError = new Error('Connection reset (503)');
      mockGenerateContentStream.mockResolvedValue(
        makePartialDisconnectIterable(['Hello', ' world'], disconnectError)
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );

      const { chunks } = await collectStreamUntilError(stream, ctx);
      expect(chunks).toEqual(['Hello', ' world']);
    });

    // EC-12: Provider failure during resolution propagates
    it('resolve() propagates error after stream error [EC-12]', async () => {
      const disconnectError = new Error('Service unavailable (503)');
      mockGenerateContentStream.mockResolvedValue(
        makePartialDisconnectIterable([], disconnectError)
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = await getCallable(ext, 'message').fn(
        { prompt: 'Test' },
        ctx
      );

      // Drain the stream first (it will throw)
      await collectStreamUntilError(stream, ctx);

      // Resolve also throws because streamError is set
      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve()
      );
    });
  });
});

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
  });

  describe('success cases', () => {
    // AC-4: embed() returns vector with .model and .dimensions
    it('returns RillVector with model and dimensions', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockEmbedContent.mockResolvedValue({
        embeddings: [{ values: mockEmbedding }],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed').fn(
        { text: 'Hello world' },
        ctx
      )) as {
        __rill_vector: true;
        data: Float32Array;
        model: string;
      };

      expect(result.__rill_vector).toBe(true);
      expect(result.model).toBe('text-embedding-004');
      expect(result.data.length).toBe(4);
      // Check approximate equality due to Float32Array precision
      for (let i = 0; i < mockEmbedding.length; i++) {
        expect(result.data[i]).toBeCloseTo(mockEmbedding[i]!, 5);
      }
    });

    it('sends correct parameters to Google embedContent API', async () => {
      mockEmbedContent.mockResolvedValue({
        embeddings: [{ values: [0.1, 0.2] }],
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'embed').fn({ text: 'Test text' }, ctx);

      expect(mockEmbedContent).toHaveBeenCalledWith({
        model: 'text-embedding-004',
        contents: ['Test text'],
        config: { abortSignal: expect.any(AbortSignal) },
      });
    });
  });

  describe('error cases', () => {
    // EC-15: Empty text
    it('throws RuntimeError for empty text', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: '' }, ctx),
        { message: 'embed text cannot be empty' }
      );
    });

    // EC-16: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'Hello' }, ctx),
        { message: 'embed_model not configured' }
      );
    });

    // EC-17: API errors
    it('throws RuntimeError for authentication error', async () => {
      mockEmbedContent.mockRejectedValue(
        new Error('401: authentication failed')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed').fn({ text: 'Hello' }, ctx),
        { message: 'Gemini API error: 401: authentication failed' }
      );
    });
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset();
  });

  describe('success cases', () => {
    // AC-5: embed_batch() returns list of vectors
    it('returns list of RillVector values', async () => {
      const mockEmbeddings = [
        { values: [0.1, 0.2] },
        { values: [0.3, 0.4] },
        { values: [0.5, 0.6] },
      ];
      mockEmbedContent.mockResolvedValue({
        embeddings: mockEmbeddings,
      });

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'embed_batch').fn(
        { texts: ['Hello', 'World', 'Test'] },
        ctx
      )) as Array<{
        __rill_vector: true;
        data: Float32Array;
        model: string;
      }>;

      expect(result).toHaveLength(3);
      expect(result[0]?.__rill_vector).toBe(true);
      expect(result[0]?.model).toBe('text-embedding-004');
      expect(result[0]?.data[0]).toBeCloseTo(0.1, 5);
      expect(result[0]?.data[1]).toBeCloseTo(0.2, 5);
    });

    // AC-24: Empty list returns empty list
    it('returns empty list for empty input without API call', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'embed_batch').fn(
        { texts: [] },
        ctx
      );

      expect(result).toEqual([]);
      expect(mockEmbedContent).not.toHaveBeenCalled();
    });
  });

  describe('error cases', () => {
    // EC-18: Non-string element
    it('throws RuntimeError for non-string element', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn(
          { texts: ['Hello', 123, 'World'] },
          ctx
        ),
        { message: 'embed_batch requires list of strings' }
      );
    });

    // EC-19: Empty string in list
    it('throws RuntimeError for empty string at specific index', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        embed_model: 'text-embedding-004',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn(
          { texts: ['Hello', '', 'World'] },
          ctx
        ),
        { message: 'embed text cannot be empty at index 1' }
      );
    });

    // EC-20: No embed_model configured
    it('throws RuntimeError when embed_model not configured', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'embed_batch').fn({ texts: ['Hello', 'World'] }, ctx),
        { message: 'embed_model not configured' }
      );
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
      annotations:
        p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

/**
 * Build an async iterable simulating Gemini streaming chunks for tool_loop.
 * The last item in the array is returned as the final response object by callAPIStreaming.
 */
async function* makeToolLoopStream(
  chunks: Array<{
    text?: string;
    functionCalls?: Array<{ name: string; args: object; id: string }>;
    candidates?: unknown[];
  }>
): AsyncGenerator<{
  text?: string;
  functionCalls?: unknown[];
  candidates?: unknown[];
}> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Collect all chunks and resolved dict from a tool_loop RillStream.
 * Chunks are dicts (text_delta, tool_call, tool_result).
 */
async function collectToolLoopStream(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<{
  chunks: Array<Record<string, unknown>>;
  resolved: Record<string, unknown>;
}> {
  const chunks: Array<Record<string, unknown>> = [];
  let current = stream as RillStream;

  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as Record<string, unknown>);
    }
  }

  const resolved = await (
    stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
  ).__rill_stream_resolve();
  return { chunks, resolved: resolved as Record<string, unknown> };
}

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  describe('streaming (AC-7, AC-8, AC-9)', () => {
    // AC-7: tool_loop() returns a RillStream value
    it('returns a RillStream', () => {
      mockGenerateContentStream.mockResolvedValue(
        makeToolLoopStream([{ text: 'Hello', functionCalls: undefined }])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { tool: makeTool(vi.fn(), { description: 'Tool' }) };

      const result = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );

      expect(isRillStream(result)).toBe(true);
    });

    // AC-8: Iterating tool_loop stream yields text_delta chunks
    it('iterating stream yields text_delta dict chunks from final turn', async () => {
      // Single turn: LLM returns text directly (no tool calls)
      mockGenerateContentStream.mockResolvedValue(
        makeToolLoopStream([{ text: 'Hello ' }, { text: 'world' }])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { tool: makeTool(vi.fn(), { description: 'Tool' }) };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );
      const { chunks } = await collectToolLoopStream(stream, ctx);

      // text_delta chunks are yielded by executeToolLoop via yieldChunk
      const textDeltas = chunks.filter((c) => c['type'] === 'text_delta');
      expect(textDeltas.length).toBeGreaterThan(0);
      textDeltas.forEach((c) => expect(typeof c['text']).toBe('string'));
    });

    // AC-8: tool_loop stream yields tool_call and tool_result events
    it('iterating stream yields tool_call and tool_result chunks during tool use', async () => {
      // Turn 1: LLM requests tool call (last chunk has functionCalls)
      // Turn 2: LLM returns final answer
      mockGenerateContentStream
        .mockResolvedValueOnce(
          makeToolLoopStream([
            {
              text: '',
              functionCalls: [
                {
                  name: 'get_weather',
                  args: { location: 'NYC' },
                  id: 'call_1',
                },
              ],
            },
          ])
        )
        .mockResolvedValueOnce(
          makeToolLoopStream([{ text: 'The weather is sunny.' }])
        );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('sunny');
      const tools = {
        get_weather: makeTool(mockToolFn, { description: 'Get weather' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather in NYC?', tools },
        ctx
      );
      const { chunks } = await collectToolLoopStream(stream, ctx);

      const toolCallChunks = chunks.filter((c) => c['type'] === 'tool_call');
      const toolResultChunks = chunks.filter(
        (c) => c['type'] === 'tool_result'
      );

      expect(toolCallChunks.length).toBe(1);
      expect(toolCallChunks[0]!['name']).toBe('get_weather');
      expect(toolResultChunks.length).toBe(1);
      expect(toolResultChunks[0]!['name']).toBe('get_weather');
      expect(mockToolFn).toHaveBeenCalledTimes(1);
    });

    // AC-9: tool_loop()() resolution dict has messages, model, usage, stop_reason
    it('resolved dict contains required fields', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeToolLoopStream([{ text: 'Final answer.' }])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { tool: makeTool(vi.fn(), { description: 'Tool' }) };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );
      const { resolved } = await collectToolLoopStream(stream, ctx);

      expect(extractLastMessageText(resolved)).toBe('Final answer.');
      expect(resolved['model']).toBe('gemini-2.0-flash');
      expect(resolved['usage']).toEqual({ input: 0, output: 0 });
      expect(resolved['stop_reason']).toBe('stop');
      // turns is emitted in the gemini:tool_loop event but not in the resolved dict
      expect(Array.isArray(resolved['messages'])).toBe(true);
    });
  });

  describe('success cases', () => {
    // AC-6: tool_loop() executes agentic loop — resolve dict shape
    it('resolved dict has messages and stop_reason after tool use', async () => {
      // Turn 1: LLM makes tool call
      mockGenerateContentStream
        .mockResolvedValueOnce(
          makeToolLoopStream([
            {
              text: '',
              functionCalls: [
                {
                  name: 'get_weather',
                  args: { location: 'NYC' },
                  id: 'call_1',
                },
              ],
            },
          ])
        )
        // Turn 2: LLM returns final text
        .mockResolvedValueOnce(
          makeToolLoopStream([{ text: 'The weather in NYC is sunny.' }])
        );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('sunny');
      const tools = {
        get_weather: makeTool(mockToolFn, {
          description: 'Get weather for location',
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather in NYC?', tools },
        ctx
      );
      const { resolved } = await collectToolLoopStream(stream, ctx);

      expect(extractLastMessageText(resolved)).toBe(
        'The weather in NYC is sunny.'
      );
      // turns is no longer in the resolved dict (emitted in gemini:tool_loop event instead)
      expect(resolved['stop_reason']).toBe('stop');
      expect(mockToolFn).toHaveBeenCalledTimes(1);
    });

    // AC-26: tool_loop() with 0 tool calls returns immediately
    it('resolves immediately when LLM does not call tools', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeToolLoopStream([{ text: 'I cannot help with that.' }])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn();
      const tools = {
        get_weather: makeTool(mockToolFn),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );
      const { resolved } = await collectToolLoopStream(stream, ctx);

      expect(extractLastMessageText(resolved)).toBe('I cannot help with that.');
      // turns is no longer in the resolved dict
      expect(mockToolFn).not.toHaveBeenCalled();
    });

    // AC-25: tool_loop() with max_turns:1 halts when tool calls require more turns
    // max_turns is now a positional number param (3rd arg), not in options dict
    // When max_turns is exceeded, the loop throws (resolve rejects) rather than
    // returning a graceful stop_reason:'max_turns'
    it('resolve rejects when max_turns is 1 and tool calls require a second turn', async () => {
      mockGenerateContentStream.mockResolvedValue(
        makeToolLoopStream([
          {
            text: '',
            functionCalls: [{ name: 'get_weather', args: {}, id: 'call_1' }],
          },
        ])
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn().mockResolvedValue('sunny')),
      };

      // max_turns is the 3rd positional arg (number), not options dict
      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, max_turns: 1 },
        ctx
      );

      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve()
      );
    });
  });

  describe('error cases', () => {
    // EC-22: Empty prompt — normalizePrompt returns invalid RillValue (synchronous return, not throw)
    it('returns invalid RillValue for empty prompt', () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { test: makeTool(vi.fn()) };

      const result = getCallable(ext, 'tool_loop').fn(
        { prompt: '   ', tools },
        ctx
      );
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result as RillValue).message).toContain(
        'prompt string cannot be empty'
      );
    });

    // EC-23: Missing tools argument — error surfaces via stream resolve
    it('stream resolve rejects when tools argument is missing', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Hello' }, ctx);

      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve(),
        { message: 'tools parameter is required' }
      );
    });

    // EC-24: Unknown tool called by LLM — error surfaces via stream resolve
    // max_errors is now a factory config option only
    it('stream resolve rejects for unknown tool after max_errors', async () => {
      // Each call to generateContentStream returns a fresh generator (not the same instance)
      mockGenerateContentStream.mockImplementation(() =>
        Promise.resolve(
          makeToolLoopStream([
            {
              text: '',
              functionCalls: [{ name: 'unknown_tool', args: {}, id: 'call_1' }],
            },
          ])
        )
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        max_errors: 3,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn()),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools },
        ctx
      );

      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve(),
        { message: 'Tool execution failed: 3 consecutive errors' }
      );
    });

    // EC-25: max_errors exceeded — error surfaces via stream resolve
    // max_errors is now a factory config option only
    it('stream resolve rejects after max_errors consecutive errors', async () => {
      // Each call to generateContentStream returns a fresh generator
      mockGenerateContentStream.mockImplementation(() =>
        Promise.resolve(
          makeToolLoopStream([
            {
              text: '',
              functionCalls: [{ name: 'failing_tool', args: {}, id: 'call_1' }],
            },
          ])
        )
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        max_errors: 2,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        failing_tool: makeTool(
          vi.fn().mockRejectedValue(new Error('Tool failed'))
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools },
        ctx
      );

      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve(),
        { message: 'Tool execution failed: 2 consecutive errors' }
      );
    });

    // EC-4/EC-12: Provider streaming API failure surfaces via stream resolve
    it('stream resolve rejects on provider streaming API failure [EC-4]', async () => {
      mockGenerateContentStream.mockRejectedValue(
        new Error('API rate limit exceeded')
      );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { tool: makeTool(vi.fn(), { description: 'Tool' }) };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );

      await expectRejectedHalt(
        (
          stream as unknown as { __rill_stream_resolve: () => Promise<unknown> }
        ).__rill_stream_resolve(),
        { message: 'Provider API error:' }
      );
    });

    // AC-17: Tool execution error mid-loop yields tool_call chunk; stream resolves with final content
    it('tool_call chunk is yielded when tool errors; stream resolves with final content [AC-17]', async () => {
      // Turn 1: LLM calls a tool (last chunk has functionCalls)
      // Turn 2: LLM recovers and returns final text after tool error
      mockGenerateContentStream
        .mockResolvedValueOnce(
          makeToolLoopStream([
            { text: '' },
            {
              text: '',
              functionCalls: [{ name: 'flaky_tool', args: {}, id: 'call_1' }],
            },
          ])
        )
        .mockResolvedValueOnce(
          makeToolLoopStream([{ text: 'Recovered from tool error.' }])
        );

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
        max_errors: 3,
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        flaky_tool: makeTool(
          vi.fn().mockRejectedValue(new Error('Transient failure')),
          { description: 'Flaky tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools },
        ctx
      );

      const { chunks } = await collectToolLoopStream(stream, ctx);

      // tool_call chunk is yielded for the failing tool
      const toolCallChunks = chunks.filter((c) => c['type'] === 'tool_call');
      expect(toolCallChunks.length).toBeGreaterThan(0);

      // Stream resolves with final content after the tool error
      const resolved = await (
        stream as unknown as {
          __rill_stream_resolve: () => Promise<Record<string, unknown>>;
        }
      ).__rill_stream_resolve();
      expect(extractLastMessageText(resolved)).toBe(
        'Recovered from tool error.'
      );
    });
  });

  describe('AC-16: partial data on mid-stream disconnect', () => {
    // AC-16: After mid-stream provider disconnect, resolve() returns partial content
    it('resolve() returns dict with accumulated content after mid-stream disconnect [AC-16]', async () => {
      // Simulate a stream that yields partial text then throws mid-iteration
      async function* makePartialStreamThenThrow(): AsyncGenerator<{
        text?: string;
      }> {
        yield { text: 'Partial content' };
        throw new Error('Connection reset by peer');
      }

      mockGenerateContentStream.mockResolvedValue(makePartialStreamThenThrow());

      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext = createGeminiExtension(config);
      const ctx = createRuntimeContext();

      const tools = { tool: makeTool(vi.fn(), { description: 'Tool' }) };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools },
        ctx
      );

      // Drain the stream (chunks may include partial text_delta before error)
      let current = stream as RillStream;
      try {
        while (!current.done) {
          const nextFn = current.next as ApplicationCallable;
          current = (await nextFn.fn({}, ctx)) as RillStream;
        }
      } catch {
        // Generator may throw — that is expected for a mid-stream disconnect
      }

      // resolve() must return partial dict with accumulated content rather than rethrowing
      const resolved = await (
        stream as unknown as {
          __rill_stream_resolve: () => Promise<Record<string, unknown>>;
        }
      ).__rill_stream_resolve();
      expect(extractLastMessageText(resolved)).toContain('Partial content');
    });
  });

  describe('concurrent independent calls', () => {
    // AC-27: Multiple concurrent tool_loop() calls operate independently
    it('handles multiple concurrent tool_loop calls independently', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const ext1 = createGeminiExtension(config);
      const ext2 = createGeminiExtension(config);
      const ctx1 = createRuntimeContext();
      const ctx2 = createRuntimeContext();

      mockGenerateContentStream
        .mockResolvedValueOnce(makeToolLoopStream([{ text: 'Response 1' }]))
        .mockResolvedValueOnce(makeToolLoopStream([{ text: 'Response 2' }]));

      const tools = {
        tool: makeTool(vi.fn(), { description: 'Tool' }),
      };

      const stream1 = getCallable(ext1, 'tool_loop').fn(
        { prompt: 'Prompt 1', tools },
        ctx1
      );
      const stream2 = getCallable(ext2, 'tool_loop').fn(
        { prompt: 'Prompt 2', tools },
        ctx2
      );

      const [r1, r2] = await Promise.all([
        collectToolLoopStream(stream1, ctx1),
        collectToolLoopStream(stream2, ctx2),
      ]);

      expect(extractLastMessageText(r1.resolved)).toBe('Response 1');
      expect(extractLastMessageText(r2.resolved)).toBe('Response 2');
      // turns is no longer in the resolved dict
    });
  });
});
