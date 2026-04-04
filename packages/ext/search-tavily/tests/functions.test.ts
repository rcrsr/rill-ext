/**
 * Function behavior tests for Tavily search extension.
 * Mocks global.fetch and verifies request/response handling.
 * Covers: AC-2, AC-5, AC-11, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21,
 *         AC-22, AC-23, AC-24, AC-26, AC-27, AC-31, AC-37,
 *         EC-2, EC-3, EC-4, EC-5, EC-6, EC-9, EC-10, EC-12, EC-17.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createTavilyExtension } from '../src/factory.js';

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

// ============================================================
// FIXTURES
// ============================================================

const VALID_CONFIG = { apiKey: 'tvly-test-key' };

const SEARCH_RESPONSE = {
  query: 'TypeScript tutorials',
  results: [
    { url: 'https://example.com/1', title: 'TS Guide', content: 'Content here', score: 0.9 },
    { url: 'https://example.com/2', title: 'TS Docs', content: 'More content', score: 0.8 },
  ],
  response_time: 1.23,
};

const EXTRACT_RESPONSE = {
  results: [
    { url: 'https://example.com/1', raw_content: 'Page content' },
  ],
  failed_results: [],
};

// ============================================================
// TESTS
// ============================================================

describe('Tavily extension host functions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // search()
  // ============================================================

  describe('search()', () => {
    it('returns results array [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect((result['results'] as unknown[]).length).toBe(2);
    });

    it('returns query and response_time fields', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(result['query']).toBe('TypeScript tutorials');
      expect(typeof result['response_time']).toBe('number');
    });

    it('sends POST to /search with Authorization Bearer header', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test query' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.tavily.com/search');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-test-key');
      expect(init.method).toBe('POST');
    });

    it('sends query in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'my search query' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['query']).toBe('my search query');
    });

    it('respects custom baseUrl', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension({ apiKey: 'test-key', baseUrl: 'https://custom.tavily.com' });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.tavily.com/search');
    });

    it('includes optional answer field when present in response', async () => {
      const responseWithAnswer = { ...SEARCH_RESPONSE, answer: 'TypeScript is a typed language.' };
      globalThis.fetch = mockFetchJson(200, responseWithAnswer);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect(result['answer']).toBe('TypeScript is a typed language.');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: '' }, ctx)
      ).rejects.toThrow(RuntimeError);

      await expect(
        getCallable(ext, 'search').fn({ query: '' }, ctx)
      ).rejects.toThrow('query is required');
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, { detail: 'Unauthorized' });
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: authentication failed');
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: rate limit exceeded');
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: server error (500)');
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: connection failed');
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: request timeout');
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: unexpected response format');
    });

    it('maps Tavily 432 to plan limit exceeded [EC-9, AC-26]', async () => {
      globalThis.fetch = mockFetchJson(432, { detail: 'Plan limit' });
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: plan limit exceeded');
    });

    it('maps Tavily 433 to pay-as-you-go limit exceeded [EC-10, AC-27]', async () => {
      globalThis.fetch = mockFetchJson(433, { detail: 'PAYG limit' });
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: pay-as-you-go limit exceeded');
    });

    it('emits success event on successful search [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:search',
          subsystem: 'extension:tavily',
          query: 'TypeScript',
          result_count: 2,
        })
      );
    });

    it('emits error event on failed search [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow();

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:error',
          subsystem: 'extension:tavily',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expect(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx)
      ).rejects.toThrow('tavily: operation cancelled');
    });
  });

  // ============================================================
  // extract()
  // ============================================================

  describe('extract()', () => {
    it('returns results and failed_results [AC-5]', async () => {
      globalThis.fetch = mockFetchJson(200, EXTRACT_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'extract').fn(
        { urls: ['https://example.com/1'] },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect(Array.isArray(result['failed_results'])).toBe(true);
    });

    it('sends POST to /extract with urls', async () => {
      const mockFetch = mockFetchJson(200, EXTRACT_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'extract').fn(
        { urls: ['https://example.com/1', 'https://example.com/2'] },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.tavily.com/extract');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['urls']).toEqual(['https://example.com/1', 'https://example.com/2']);
    });

    it('sends Authorization Bearer header', async () => {
      const mockFetch = mockFetchJson(200, EXTRACT_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-test-key');
    });

    it('handles mixed URL partial results [AC-37]', async () => {
      const mixedResponse = {
        results: [{ url: 'https://example.com/1', raw_content: 'content' }],
        failed_results: [{ url: 'https://example.com/bad', error: 'Access denied' }],
      };
      globalThis.fetch = mockFetchJson(200, mixedResponse);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'extract').fn(
        { urls: ['https://example.com/1', 'https://example.com/bad'] },
        ctx
      )) as Record<string, unknown>;

      expect((result['results'] as unknown[]).length).toBe(1);
      expect((result['failed_results'] as unknown[]).length).toBe(1);
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: authentication failed');
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: rate limit exceeded');
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: server error (500)');
    });

    it('maps network failure to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Network error'));
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: connection failed');
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: request timeout');
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = mockFetchNonJson();
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: unexpected response format');
    });

    it('maps Tavily 432 to plan limit exceeded [EC-9, AC-26]', async () => {
      globalThis.fetch = mockFetchJson(432, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: plan limit exceeded');
    });

    it('maps Tavily 433 to pay-as-you-go limit exceeded [EC-10, AC-27]', async () => {
      globalThis.fetch = mockFetchJson(433, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: pay-as-you-go limit exceeded');
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, EXTRACT_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'extract').fn({ urls: ['https://example.com/1'] }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:extract',
          subsystem: 'extension:tavily',
        })
      );
    });

    it('emits error event on failure [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow();

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:error',
          subsystem: 'extension:tavily',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expect(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx)
      ).rejects.toThrow('tavily: operation cancelled');
    });
  });

  // ============================================================
  // dispose with in-flight requests
  // ============================================================

  describe('dispose with in-flight requests [AC-22]', () => {
    it('dispose cancels in-flight search request [AC-22]', async () => {
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

      const ext = createTavilyExtension(VALID_CONFIG);
      const ctx = createRuntimeContext();

      // Start search without awaiting — request stays in-flight
      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      // Dispose while request is in-flight
      await ext.dispose!();

      // The in-flight request should reject with mapped AbortError
      await expect(promise).rejects.toThrow('tavily: request timeout');
    });
  });
});
