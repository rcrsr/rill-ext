/**
 * Function behavior tests for Brave search extension.
 * Mocks global.fetch and verifies request/response handling.
 * Covers: AC-2, AC-3, AC-8, AC-11, AC-16, AC-17, AC-18, AC-19, AC-20,
 *         AC-21, AC-22, AC-23, AC-24, AC-28, AC-31, AC-32, AC-33,
 *         EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-11, EC-12, EC-17, EC-18, EC-19.
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
import { createBraveExtension } from '../src/factory.js';

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

const VALID_CONFIG = { apiKey: 'brave-test-key' };

const SEARCH_RESPONSE = {
  query: { original: 'TypeScript tutorials' },
  web: {
    type: 'search',
    results: [
      { title: 'TypeScript Guide', url: 'https://example.com/1', description: 'Learn TypeScript' },
      { title: 'TypeScript Docs', url: 'https://example.com/2', description: 'Official docs' },
    ],
  },
};

const NEWS_RESPONSE = {
  results: [
    { title: 'TypeScript 5.0 Released', url: 'https://news.example.com/1', description: 'New version' },
    { title: 'TypeScript Updates', url: 'https://news.example.com/2', description: 'Latest changes' },
  ],
};

const SUMMARIZE_STEP1_RESPONSE = {
  query: { original: 'What is TypeScript?' },
  summarizer: { key: 'test-summarizer-key' },
  web: { results: [] },
};

const SUMMARIZE_STEP2_RESPONSE = {
  summary: 'TypeScript is a typed superset of JavaScript.',
  title: 'TypeScript Overview',
  followups: ['What are TypeScript generics?', 'How does TypeScript differ from JavaScript?'],
  context: [{ url: 'https://typescriptlang.org', title: 'TypeScript Docs' }],
};

// ============================================================
// TESTS
// ============================================================

describe('Brave extension host functions', () => {
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
    it('returns web results dict [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(result['web']).toBeDefined();
    });

    it('returns result count from web.results [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      const web = result['web'] as { results?: unknown[] } | undefined;
      expect(web).toBeDefined();
      expect(Array.isArray(web?.results)).toBe(true);
      expect(web?.results).toHaveLength(2);
    });

    it('sends GET to /res/v1/web/search with q param', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/res/v1/web/search');
      expect(url).toContain('q=TypeScript');
      expect(init.method).toBe('GET');
    });

    it('sends X-Subscription-Token header', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-test-key');
    });

    it('sends Cache-Control: no-cache header', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Cache-Control']).toBe('no-cache');
    });

    it('respects custom baseUrl', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension({ apiKey: 'test-key', baseUrl: 'https://custom.search.brave.com' }, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://custom.search.brave.com/res/v1/web/search');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'search').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: authentication failed'
      );
    });

    it('maps HTTP 403 with code to access denied [EC-11, AC-28]', async () => {
      globalThis.fetch = mockFetchJson(403, {
        type: 'ErrorResponse',
        error: { id: 'err-1', status: 403, detail: 'Plan restricted', code: 'PLAN_RESTRICTED' },
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: access denied (PLAN_RESTRICTED)'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: unexpected response format'
      );
    });

    it('maps unknown error with message [EC-7]', async () => {
      globalThis.fetch = mockFetchReject(new Error('Something went wrong'));
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: Something went wrong'
      );
    });

    it('emits success event on successful search [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:search',
          subsystem: 'extension:brave',
          query: 'TypeScript',
        })
      );
    });

    it('emits error event on failed search [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'search').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:error',
          subsystem: 'extension:brave',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'brave: operation cancelled'
      );
    });
  });

  // ============================================================
  // news()
  // ============================================================

  describe('news()', () => {
    it('returns results tuple [AC-3]', async () => {
      globalThis.fetch = mockFetchJson(200, NEWS_RESPONSE);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'news').fn(
        { query: 'TypeScript news' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect((result['results'] as unknown[]).length).toBe(2);
    });

    it('sends GET to /res/v1/news/search with q param', async () => {
      const mockFetch = mockFetchJson(200, NEWS_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'news').fn({ query: 'TypeScript news' }, ctx);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/res/v1/news/search');
      expect(url).toContain('q=TypeScript+news');
      expect(init.method).toBe('GET');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'news').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: authentication failed'
      );
    });

    it('maps HTTP 403 with code to access denied [EC-11, AC-28]', async () => {
      globalThis.fetch = mockFetchJson(403, {
        type: 'ErrorResponse',
        error: { id: 'err-2', status: 403, detail: 'Plan restricted', code: 'SUBSCRIPTION_EXPIRED' },
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: access denied (SUBSCRIPTION_EXPIRED)'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Network error'));
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = mockFetchNonJson();
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: unexpected response format'
      );
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, NEWS_RESPONSE);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'news').fn({ query: 'TypeScript news' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:news',
          subsystem: 'extension:brave',
          query: 'TypeScript news',
          result_count: 2,
        })
      );
    });

    it('emits error event on failure [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'news').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:error',
          subsystem: 'extension:brave',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'brave: operation cancelled'
      );
    });
  });

  // ============================================================
  // summarize()
  // ============================================================

  describe('summarize()', () => {
    it('returns summary dict with summary, title, followups, context [AC-8]', async () => {
      // First call returns summarizer key, second call returns summary
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP1_RESPONSE),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP2_RESPONSE),
        });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'summarize').fn(
        { query: 'What is TypeScript?' },
        ctx
      )) as Record<string, unknown>;

      expect(result['summary']).toBe('TypeScript is a typed superset of JavaScript.');
      expect(result['title']).toBe('TypeScript Overview');
      expect(Array.isArray(result['followups'])).toBe(true);
      expect(Array.isArray(result['context'])).toBe(true);
    });

    it('step 1 calls /res/v1/web/search with summary=1 param', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP1_RESPONSE),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP2_RESPONSE),
        });
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'summarize').fn({ query: 'What is TypeScript?' }, ctx);

      const [firstUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(firstUrl).toContain('/res/v1/web/search');
      expect(firstUrl).toContain('summary=1');
    });

    it('step 2 calls /res/v1/summarizer/search with key param', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP1_RESPONSE),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP2_RESPONSE),
        });
      globalThis.fetch = mockFetch;
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'summarize').fn({ query: 'What is TypeScript?' }, ctx);

      const [secondUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(secondUrl).toContain('/res/v1/summarizer/search');
      expect(secondUrl).toContain('key=test-summarizer-key');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'summarize').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('throws brave: summarizer key not found when key absent [EC-19, AC-33]', async () => {
      // Step 1 response without summarizer key
      globalThis.fetch = mockFetchJson(200, {
        query: { original: 'test' },
        web: { results: [] },
        // No summarizer field
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: summarizer key not found'
      );
    });

    it('throws brave: summarizer key not found when summarizer has no key [EC-19, AC-33]', async () => {
      globalThis.fetch = mockFetchJson(200, {
        query: { original: 'test' },
        web: { results: [] },
        summarizer: {},
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: summarizer key not found'
      );
    });

    it('throws brave: summarizer request failed when step 2 fails [EC-18, AC-32]', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP1_RESPONSE),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: vi.fn().mockResolvedValue({ error: 'Internal Server Error' }),
        });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'What is TypeScript?' }, ctx),
        'brave: summarizer request failed'
      );
    });

    it('maps step 1 HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: authentication failed'
      );
    });

    it('maps step 1 HTTP 403 with code to access denied [EC-11, AC-28]', async () => {
      globalThis.fetch = mockFetchJson(403, {
        type: 'ErrorResponse',
        error: { id: 'err-3', status: 403, detail: 'Plan restricted', code: 'PLAN_RESTRICTED' },
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: access denied (PLAN_RESTRICTED)'
      );
    });

    it('maps step 1 HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: rate limit exceeded'
      );
    });

    it('maps step 1 HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: request timeout'
      );
    });

    it('maps step 1 non-JSON to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: unexpected response format'
      );
    });

    it('emits success event on successful summarize [AC-11]', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP1_RESPONSE),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(SUMMARIZE_STEP2_RESPONSE),
        });
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'summarize').fn({ query: 'What is TypeScript?' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:summarize',
          subsystem: 'extension:brave',
          query: 'What is TypeScript?',
        })
      );
    });

    it('emits error event on failure [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'summarize').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'brave:error',
          subsystem: 'extension:brave',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'summarize').fn({ query: 'test' }, ctx),
        'brave: operation cancelled'
      );
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

      const ext = createBraveExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      // Start search without awaiting — request stays in-flight
      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      // Dispose while request is in-flight
      await ext.dispose!();

      // The in-flight request should reject with mapped AbortError
      await expectInvalidWithMessage(promise, 'brave: request timeout');
    });
  });
});
