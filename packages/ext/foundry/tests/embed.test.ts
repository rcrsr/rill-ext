/**
 * Tests for embed() and embed_batch() host functions.
 * Covers AC-4 and AC-5 from the specification.
 *
 * AC-4: embed called with text returns list of floats (rill vector)
 * AC-5: embed_batch called with text list returns list of float lists (list of rill vectors)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
} from '@rcrsr/rill';
import { createFoundryExtension } from '../src/factory.js';
import type { FoundryConfig } from '../src/types.js';

// ============================================================
// MOCK SETUP
// ============================================================

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

  class MockAzureOpenAI {
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
  }

  return {
    AzureOpenAI: MockAzureOpenAI,
    APIError: MockAPIError,
  };
});

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// BASE CONFIG
// ============================================================

const baseConfig: FoundryConfig = {
  endpoint: 'https://my-foundry.openai.azure.com',
  auth: { type: 'api-key', key: 'test-key' },
  inference: {
    model: 'gpt-4o',
    apiVersion: '2025-01-01-preview',
    embedModel: 'text-embedding-3-small',
  },
};

// ============================================================
// EMBED() TESTS
// ============================================================

describe('embed() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  // AC-4: embed returns a rill vector with float data
  it('returns a rill vector with float data', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed').fn(
      { text: 'test text' },
      ctx
    )) as Record<string, unknown>;

    expect(result['__rill_vector']).toBe(true);
    expect(result['data']).toBeInstanceOf(Float32Array);
    expect((result['data'] as Float32Array).length).toBe(1536);
  });

  // AC-4: vector carries the embed model name
  it('returns vector with correct model field', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed').fn(
      { text: 'test text' },
      ctx
    )) as Record<string, unknown>;

    expect(result['model']).toBe('text-embedding-3-small');
  });

  // AC-4: different embedding dimensions are handled correctly
  it('handles different embedding dimensions', async () => {
    const mockEmbedding = new Array(768).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
      model: 'text-embedding-3-large',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    const config: FoundryConfig = {
      ...baseConfig,
      inference: {
        ...baseConfig.inference!,
        embedModel: 'text-embedding-3-large',
      },
    };

    const ext = await createFoundryExtension(config);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed').fn(
      { text: 'test text' },
      ctx
    )) as Record<string, unknown>;

    expect((result['data'] as Float32Array).length).toBe(768);
  });

  // AC-4: throws when embed_model is not configured
  it('throws RuntimeError when embedModel not configured', async () => {
    const config: FoundryConfig = {
      endpoint: 'https://my-foundry.openai.azure.com',
      auth: { type: 'api-key', key: 'test-key' },
      inference: {
        model: 'gpt-4o',
        apiVersion: '2025-01-01-preview',
        // No embedModel
      },
    };

    const ext = await createFoundryExtension(config);
    const ctx = createRuntimeContext();

    await expect(
      getCallable(ext, 'embed').fn({ text: 'test' }, ctx)
    ).rejects.toThrow('embed_model not configured');
  });

  // AC-4: throws RuntimeError for empty text
  it('throws RuntimeError for empty text', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    await expect(
      getCallable(ext, 'embed').fn({ text: '' }, ctx)
    ).rejects.toThrow('embed text cannot be empty');
  });

  // AC-4: throws RuntimeError for whitespace-only text
  it('throws RuntimeError for whitespace-only text', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    await expect(
      getCallable(ext, 'embed').fn({ text: '   \t\n  ' }, ctx)
    ).rejects.toThrow('embed text cannot be empty');
  });

  // AC-4: calls embeddings API with correct model and text
  it('sends correct model and text to the embeddings API', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    await getCallable(ext, 'embed').fn({ text: 'hello world' }, ctx);

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        input: 'hello world',
        encoding_format: 'float',
      })
    );
  });
});

// ============================================================
// EMBED_BATCH() TESTS
// ============================================================

describe('embed_batch() function', () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  // AC-5: embed_batch returns list of vectors
  it('returns list of rill vectors for multiple texts', async () => {
    const mockEmbedding1 = new Array(1536).fill(0).map((_, i) => i * 0.001);
    const mockEmbedding2 = new Array(1536).fill(0).map((_, i) => i * 0.002);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding1 }, { embedding: mockEmbedding2 }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed_batch').fn(
      { texts: ['text1', 'text2'] },
      ctx
    )) as Array<Record<string, unknown>>;

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]?.['__rill_vector']).toBe(true);
    expect(result[1]?.['__rill_vector']).toBe(true);
  });

  // AC-5: each vector has Float32Array data
  it('each vector contains Float32Array data', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }, { embedding: mockEmbedding }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed_batch').fn(
      { texts: ['a', 'b'] },
      ctx
    )) as Array<Record<string, unknown>>;

    expect(result[0]?.['data']).toBeInstanceOf(Float32Array);
    expect(result[1]?.['data']).toBeInstanceOf(Float32Array);
    expect((result[0]?.['data'] as Float32Array).length).toBe(1536);
  });

  // AC-5: each vector carries the embed model
  it('each vector has correct model field', async () => {
    const mockEmbedding = new Array(512).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }, { embedding: mockEmbedding }],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed_batch').fn(
      { texts: ['hello', 'world'] },
      ctx
    )) as Array<Record<string, unknown>>;

    expect(result[0]?.['model']).toBe('text-embedding-3-small');
    expect(result[1]?.['model']).toBe('text-embedding-3-small');
  });

  // AC-5: empty list returns empty array without calling API
  it('returns empty list for empty input without calling API', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'embed_batch').fn(
      { texts: [] },
      ctx
    )) as unknown[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });

  // AC-5: throws when embedModel not configured
  it('throws RuntimeError when embedModel not configured', async () => {
    const config: FoundryConfig = {
      endpoint: 'https://my-foundry.openai.azure.com',
      auth: { type: 'api-key', key: 'test-key' },
      inference: {
        model: 'gpt-4o',
        apiVersion: '2025-01-01-preview',
        // No embedModel
      },
    };

    const ext = await createFoundryExtension(config);
    const ctx = createRuntimeContext();

    await expect(
      getCallable(ext, 'embed_batch').fn({ texts: ['test'] }, ctx)
    ).rejects.toThrow('embed_model not configured');
  });

  // AC-5: throws RuntimeError for non-string element
  it('throws RuntimeError for non-string element in texts list', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    await expect(
      getCallable(ext, 'embed_batch').fn({ texts: ['valid', 123, 'text'] }, ctx)
    ).rejects.toThrow('embed_batch requires list of strings');
  });

  // AC-5: sends all texts to the embeddings API
  it('sends all texts to the embeddings API in one call', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    mockEmbeddingsCreate.mockResolvedValue({
      data: [
        { embedding: mockEmbedding },
        { embedding: mockEmbedding },
        { embedding: mockEmbedding },
      ],
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 15, total_tokens: 15 },
    });

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    await getCallable(ext, 'embed_batch').fn(
      { texts: ['alpha', 'beta', 'gamma'] },
      ctx
    );

    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        input: ['alpha', 'beta', 'gamma'],
        encoding_format: 'float',
      })
    );
  });
});
