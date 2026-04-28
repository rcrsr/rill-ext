/**
 * Function behavior tests for SearXNG search extension.
 * Mocks global.fetch and verifies request/response handling.
 * Covers: AC-2, AC-9, AC-11, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21,
 *         AC-22, AC-23, AC-24, AC-31, AC-39, AC-40,
 *         EC-4, EC-5, EC-6, EC-12, EC-17.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
  type RillValue,
} from "@rcrsr/rill";
import { createSearxngExtension } from '../src/factory.js';

function makeFactoryCtx(signal?: AbortSignal): ExtensionFactoryCtx {
  return {
    signal: signal ?? new AbortController().signal,
    registerErrorCode: () => {},
  };
}

async function expectInvalidWithMessage(
  promise: Promise<unknown>,
  needle: string
): Promise<RillValue> {
  const result = (await promise) as RillValue;
  expect(isInvalid(result)).toBe(true);
  expect(getStatus(result).message).toContain(needle);
  return result;
}
import type { SearxngConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Build a fetch mock that returns a JSON response with given status. */
function mockFetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

/** Build a fetch mock that rejects with the given error. */
function mockFetchReject(error: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(error);
}

/** Build a fetch mock whose json() rejects with a SyntaxError (non-JSON response). */
function mockFetchNonJson(status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
  });
}

/**
 * Create a test extension with the probe mocked to succeed.
 * After creation, globalThis.fetch is reset so each test can set its own mock.
 */
async function createTestExtension(config?: Partial<SearxngConfig>): Promise<{ value: unknown; dispose?: () => Promise<void> }> {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ formats: ['html', 'json'] }),
  });
  return createSearxngExtension({ baseUrl: 'http://localhost:8888', ...config }, makeFactoryCtx());
}

// ============================================================
// FIXTURES
// ============================================================

const SEARCH_RESPONSE = {
  query: 'TypeScript tutorials',
  number_of_results: 2,
  results: [
    { url: 'https://example.com/1', title: 'TS Guide', content: 'Content here' },
    { url: 'https://example.com/2', title: 'TS Docs', content: 'More content' },
  ],
};

const CONFIG_RESPONSE = {
  categories: ['general', 'images', 'news'],
  engines: [{ name: 'google', shortcut: 'g' }],
  plugins: ['limiter', 'oa_doi_rewrite'],
  locales: { 'en': 'English' },
};

// ============================================================
// TESTS
// ============================================================

describe('SearXNG extension host functions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  }, makeFactoryCtx());

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // search()
  // ============================================================

  describe('search()', () => {
    it('returns results dict [AC-2]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect((result['results'] as unknown[]).length).toBe(2);
    });

    it('returns query and number_of_results fields [AC-2]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(result['query']).toBe('TypeScript tutorials');
      expect(typeof result['number_of_results']).toBe('number');
    });

    it('sends GET to /search with format=json and query params', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test query' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('http://localhost:8888/search');
      expect(url).toContain('format=json');
      expect(url).toContain('q=test+query');
      expect(init.method).toBe('GET');
    });

    it('sends no Authorization header (no API key) [AC-1]', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string> | undefined)?.['Authorization']).toBeUndefined();
    });

    it('accepts number_of_results: 0 as valid [AC-40]', async () => {
      const zeroResults = { ...SEARCH_RESPONSE, number_of_results: 0, results: [] };
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, zeroResults);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'obscure query' },
        ctx
      )) as Record<string, unknown>;

      expect(result['number_of_results']).toBe(0);
      expect((result['results'] as unknown[]).length).toBe(0);
    });

    it('includes suggestions when present in response', async () => {
      const responseWithSuggestions = {
        ...SEARCH_RESPONSE,
        suggestions: ['TypeScript generics', 'TypeScript decorators'],
      };
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, responseWithSuggestions);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['suggestions'])).toBe(true);
    });

    it('throws #INVALID_INPUT for empty query [EC-17, AC-16]', async () => {
      const ext = await createTestExtension();
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'search').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('rejects time_range: "week" [AC-39]', async () => {
      const ext = await createTestExtension();
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn(
          { query: 'news', options: { time_range: 'week' } },
          ctx
        ),
        'time_range must be one of: day, month, year'
      );
    });

    it('accepts time_range: "day" [AC-39]', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn(
          { query: 'news', options: { time_range: 'day' } },
          ctx
        )
      ).resolves.toBeDefined();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('time_range=day');
    });

    it('accepts time_range: "month" [AC-39]', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn(
          { query: 'news', options: { time_range: 'month' } },
          ctx
        )
      ).resolves.toBeDefined();
    });

    it('accepts time_range: "year" [AC-39]', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn(
          { query: 'news', options: { time_range: 'year' } },
          ctx
        )
      ).resolves.toBeDefined();
    });

    it('maps HTTP 401 to server error (no auth header) [AC-17]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(401, {});
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: server error (401)'
      );
    });

    it('maps HTTP 403 to server error [AC-17]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(403, {});
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: server error (403)'
      );
    });

    it('maps HTTP 429 to server error (SearXNG has no specific 429 handling) [AC-18]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(429, {});
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: server error (429)'
      );
    });

    it('maps HTTP 500 to server error [AC-20]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(500, {});
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const ext = await createTestExtension();
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchNonJson();
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: unexpected response format'
      );
    });

    it('emits success event on successful search [AC-11]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'searxng:search',
          subsystem: 'extension:searxng',
          query: 'TypeScript',
          result_count: 2,
        })
      );
    });

    it('emits error event on failed search [AC-24]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(500, {});
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'search').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'searxng:error',
          subsystem: 'extension:searxng',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = await createTestExtension();
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'searxng: operation cancelled'
      );
    });
  });

  // ============================================================
  // config()
  // ============================================================

  describe('config()', () => {
    it('returns config dict with categories, engines, plugins, locales [AC-9]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, CONFIG_RESPONSE);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'config').fn({}, ctx)) as Record<string, unknown>;

      expect(result['categories']).toBeDefined();
      expect(result['engines']).toBeDefined();
      expect(result['plugins']).toBeDefined();
      expect(result['locales']).toBeDefined();
    });

    it('returns categories as an array [AC-9]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, CONFIG_RESPONSE);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'config').fn({}, ctx)) as Record<string, unknown>;

      expect(Array.isArray(result['categories'])).toBe(true);
    });

    it('sends GET to /config with no body', async () => {
      const ext = await createTestExtension();
      const mockFetch = mockFetchJson(200, CONFIG_RESPONSE);
      globalThis.fetch = mockFetch;
      const ctx = createRuntimeContext();

      await getCallable(ext, 'config').fn({}, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8888/config');
      expect(init.method).toBe('GET');
    });

    it('maps HTTP 503 to connection failed', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(503, {});
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'config').fn({}, ctx),
        'searxng: connection failed'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'config').fn({}, ctx),
        'searxng: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const ext = await createTestExtension();
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'config').fn({}, ctx),
        'searxng: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchNonJson();
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'config').fn({}, ctx),
        'searxng: unexpected response format'
      );
    });

    it('emits success event on successful config fetch [AC-11]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(200, CONFIG_RESPONSE);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'config').fn({}, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'searxng:config',
          subsystem: 'extension:searxng',
        })
      );
    });

    it('emits error event on failed config fetch [AC-24]', async () => {
      const ext = await createTestExtension();
      globalThis.fetch = mockFetchJson(503, {});
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'config').fn({}, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'searxng:error',
          subsystem: 'extension:searxng',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = await createTestExtension();
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'config').fn({}, ctx),
        'searxng: operation cancelled'
      );
    });
  });

  // ============================================================
  // dispose with in-flight requests [AC-22]
  // ============================================================

  describe('dispose with in-flight requests [AC-22]', () => {
    it('dispose cancels in-flight search request [AC-22]', async () => {
      const ext = await createTestExtension();

      // Mock fetch that hangs until its signal is aborted
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const ctx = createRuntimeContext();

      // Start search without awaiting — request stays in-flight
      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      // Dispose while request is in-flight
      await ext.dispose!();

      // The in-flight request should reject with mapped AbortError
      await expectInvalidWithMessage(promise, 'searxng: request timeout');
    });
  });
});
