/**
 * Search function tests for Azure AI Foundry extension.
 * Tests callSearch/search host function: fetch mocking, response mapping,
 * config validation, event emission, and error handling.
 *
 * Covers: AC-11, AC-21, AC-22, AC-34, EC-10, EC-11.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';
import { expectRejectedHalt, expectHalt } from "./_halt-helpers.js";

// ============================================================
// MODULE MOCK
// ============================================================

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
    default: class MockAzureOpenAI {
      chat = { completions: { create: vi.fn(), stream: vi.fn() } };
      embeddings = { create: vi.fn() };
      responses = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = { completions: { create: vi.fn(), stream: vi.fn() } };
      embeddings = { create: vi.fn() };
      responses = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

type AsyncHostFn = (
  args: Record<string, unknown>,
  ctx: unknown
) => Promise<unknown>;
type ExtValue = Record<string, { fn: AsyncHostFn }>;

function getHostFn(ext: { value: unknown }, name: string) {
  return (ext.value as ExtValue)[name]!;
}

/** Build a fetch mock returning a JSON response with the given status. */
function mockFetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// ============================================================
// FIXTURES
// ============================================================

/** Valid config with search configured. */
function configWithSearch(indexName = 'my-index'): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    search: {
      endpoint: 'https://my-search.search.windows.net',
      indexName,
      apiKey: 'search-api-key',
    },
  };
}

/** Valid config without search. */
function configWithoutSearch(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
  };
}

/** Successful Azure AI Search response with two results. */
const SEARCH_RESPONSE = {
  value: [
    {
      '@search.score': 0.95,
      id: 'doc-1',
      title: 'First document',
      body: 'Content of first document',
    },
    {
      '@search.score': 0.82,
      id: 'doc-2',
      title: 'Second document',
      body: 'Content of second document',
    },
  ],
};

/** Successful Azure AI Search response with one result and no id field. */
const SEARCH_RESPONSE_NO_ID = {
  value: [
    {
      '@search.score': 0.75,
      key: 'key-doc-1',
      title: 'Document with key field',
    },
  ],
};

/** Empty Azure AI Search response. */
const EMPTY_SEARCH_RESPONSE = { value: [] };

// ============================================================
// TESTS
// ============================================================

describe('search() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------
  // AC-11: Returns list of { id, score, content }
  // --------------------------------------------------------

  describe('returns list of { id, score, content } [AC-11]', () => {
    it('returns array of result dicts [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'azure search', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('each result has id, score, and content fields [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'azure search', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      const first = result[0]!;
      expect('id' in first).toBe(true);
      expect('score' in first).toBe(true);
      expect('content' in first).toBe(true);
    });

    it('score matches @search.score from API response [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'azure search', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      expect(result[0]!['score']).toBe(0.95);
      expect(result[1]!['score']).toBe(0.82);
    });

    it('id matches document id field [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'test', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      expect(result[0]!['id']).toBe('doc-1');
      expect(result[1]!['id']).toBe('doc-2');
    });

    it('content dict excludes @search.* metadata fields [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'test', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      const content = result[0]!['content'] as Record<string, unknown>;
      expect('@search.score' in content).toBe(false);
    });

    it('content includes document-specific fields [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'test', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      const content = result[0]!['content'] as Record<string, unknown>;
      expect(content['title']).toBe('First document');
      expect(content['body']).toBe('Content of first document');
    });

    it('extracts id from key field when id field absent [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE_NO_ID);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'test', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      expect(result[0]!['id']).toBe('key-doc-1');
    });

    it('returns empty array when no results', async () => {
      globalThis.fetch = mockFetchJson(200, EMPTY_SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      const result = (await getHostFn(ext, 'search').fn(
        { query: 'no results', options: {} },
        ctx
      )) as Array<Record<string, unknown>>;

      expect(result.length).toBe(0);
    });
  });

  // --------------------------------------------------------
  // HTTP request structure
  // --------------------------------------------------------

  describe('HTTP request', () => {
    it('POSTs to {search.endpoint}/indexes/{indexName}/docs/search', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('my-index'));
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn({ query: 'hello', options: {} }, ctx);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://my-search.search.windows.net');
      expect(url).toContain('/indexes/my-index/docs/search');
      expect(init.method).toBe('POST');
    });

    it('sends api-version query param from config', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const config: FoundryConfig = {
        endpoint: 'https://my-foundry.openai.azure.com',
        auth: { type: 'api-key', key: 'test-api-key' },
        search: {
          endpoint: 'https://my-search.search.windows.net',
          indexName: 'my-index',
          apiVersion: '2024-11-01-preview',
        },
      };

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(config);
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('api-version=2024-11-01-preview');
    });

    it('sends api-key header when search.apiKey is set', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['api-key']).toBe('search-api-key');
    });

    it('includes search query in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn({ query: 'my query', options: {} }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['search']).toBe('my query');
    });
  });

  // --------------------------------------------------------
  // AC-21, EC-10: search not configured
  // --------------------------------------------------------

  describe('search not configured [AC-21, EC-10]', () => {
    it('halts with #UNAVAILABLE when search config absent [AC-21, EC-10]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSearch());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx),
        { code: 'UNAVAILABLE', provider: 'foundry' }
      );
    });

    it('error message is "foundry: search not configured" [EC-10]', async () => {
      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSearch());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx)
      , { message: 'foundry: search not configured' });
    });

    it('fetch is not called when search not configured [AC-21]', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithoutSearch());
      const ctx = createRuntimeContext();

      await expect(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx)
      ).rejects.toThrow();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // AC-22, EC-11: Non-existent index
  // --------------------------------------------------------

  describe('non-existent index [AC-22, EC-11]', () => {
    it('halts with #NOT_FOUND when index returns HTTP 404 [AC-22, EC-11]', async () => {
      globalThis.fetch = mockFetchJson(404, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('missing-index'));
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx),
        { code: 'NOT_FOUND', provider: 'foundry' }
      );
    });

    it('error message includes index name [EC-11]', async () => {
      globalThis.fetch = mockFetchJson(404, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('missing-index'));
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx),
        { message: "foundry: search index 'missing-index' not found" }
      );
    });
  });

  // --------------------------------------------------------
  // AC-34: Explicit index option overrides config default
  // --------------------------------------------------------

  describe('explicit index option overrides config default [AC-34]', () => {
    it('uses options.index when provided [AC-34]', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('default-index'));
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn(
        { query: 'test', options: { index: 'override-index' } },
        ctx
      );

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/indexes/override-index/docs/search');
    });

    it('uses config indexName when options.index not provided [AC-34]', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('default-index'));
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/indexes/default-index/docs/search');
    });

    it('non-existent override index throws with override name [EC-11]', async () => {
      globalThis.fetch = mockFetchJson(404, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('default-index'));
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn(
          { query: 'test', options: { index: 'other-index' } },
          ctx
        ),
        { message: "foundry: search index 'other-index' not found" }
      );
    });
  });

  // --------------------------------------------------------
  // Query options
  // --------------------------------------------------------

  describe('query options', () => {
    it('sends queryType from options in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn(
        { query: 'test', options: { queryType: 'simple' } },
        ctx
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['queryType']).toBe('simple');
    });

    it('sends top from options in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn(
        { query: 'test', options: { top: 5 } },
        ctx
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['top']).toBe(5);
    });

    it('sends filter from options in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await getHostFn(ext, 'search').fn(
        { query: 'test', options: { filter: "category eq 'news'" } },
        ctx
      );

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['filter']).toBe("category eq 'news'");
    });
  });

  // --------------------------------------------------------
  // Event emission
  // --------------------------------------------------------

  describe('event emission', () => {
    it('emits foundry:search event on success', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('my-index'));
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:search',
          subsystem: 'extension:foundry',
          index: 'my-index',
          resultCount: 2,
        })
      );
    });

    it('emits foundry:search:error event on HTTP failure', async () => {
      globalThis.fetch = mockFetchJson(401, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch('my-index'));
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx)
      ).rejects.toThrow();

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'foundry:search:error',
          subsystem: 'extension:foundry',
          index: 'my-index',
          error: expect.any(String),
        })
      );
    });
  });

  // --------------------------------------------------------
  // HTTP error handling
  // --------------------------------------------------------

  describe('HTTP error handling', () => {
    it('maps HTTP 401 to authentication failed', async () => {
      globalThis.fetch = mockFetchJson(401, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx)
      , { message: 'foundry: authentication failed' });
    });

    it('maps HTTP 429 to rate limit exceeded', async () => {
      globalThis.fetch = mockFetchJson(429, {});

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(configWithSearch());
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getHostFn(ext, 'search').fn({ query: 'test', options: {} }, ctx)
      , { message: 'foundry: rate limit exceeded' });
    });
  });
});
