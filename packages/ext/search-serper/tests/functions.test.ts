/**
 * Function behavior tests for Serper search extension.
 * Mocks global.fetch and verifies request/response handling.
 * Covers: AC-2, AC-3, AC-4, AC-11, AC-16, AC-17, AC-18, AC-19, AC-20,
 *         AC-21, AC-22, AC-23, AC-24, AC-31, AC-38,
 *         EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-12, EC-17.
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
import { createSerperExtension } from '../src/factory.js';

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

const VALID_CONFIG = { apiKey: 'serper-test-key' };

const SEARCH_RESPONSE = {
  searchParameters: { q: 'TypeScript tutorials', type: 'search' },
  organic: [
    { title: 'TypeScript Guide', link: 'https://example.com/1', snippet: 'Learn TypeScript', position: 1 },
    { title: 'TypeScript Docs', link: 'https://example.com/2', snippet: 'Official docs', position: 2 },
  ],
};

const NEWS_RESPONSE = {
  searchParameters: { q: 'TypeScript news', type: 'news' },
  news: [
    { title: 'TypeScript 5.0 Released', link: 'https://news.example.com/1', snippet: 'New version' },
    { title: 'TypeScript Updates', link: 'https://news.example.com/2', snippet: 'Latest changes' },
  ],
};

const IMAGES_RESPONSE = {
  searchParameters: { q: 'TypeScript logo', type: 'images' },
  images: [
    {
      title: 'TypeScript Logo',
      imageUrl: 'https://images.example.com/ts-logo.png',
      imageWidth: 400,
      imageHeight: 400,
      thumbnailUrl: 'https://thumbs.example.com/ts-logo-thumb.png',
      source: 'typescriptlang.org',
      link: 'https://typescriptlang.org',
    },
  ],
};

// ============================================================
// TESTS
// ============================================================

describe('Serper extension host functions', () => {
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
    it('returns organic results [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['organic'])).toBe(true);
      expect((result['organic'] as unknown[]).length).toBe(2);
    });

    it('returns search_parameters field [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(result['search_parameters']).toBeDefined();
    });

    it('omits optional fields when absent [AC-38]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect('answer_box' in result).toBe(false);
      expect('knowledge_graph' in result).toBe(false);
      expect('people_also_ask' in result).toBe(false);
      expect('related_searches' in result).toBe(false);
    });

    it('includes optional fields when present [AC-38]', async () => {
      const responseWithOptionals = {
        ...SEARCH_RESPONSE,
        answerBox: { answer: 'TypeScript is a typed superset of JavaScript' },
        knowledgeGraph: { title: 'TypeScript' },
        peopleAlsoAsk: [{ question: 'What is TypeScript?' }],
        relatedSearches: [{ query: 'JavaScript' }],
      };
      globalThis.fetch = mockFetchJson(200, responseWithOptionals);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect(result['answer_box']).toBeDefined();
      expect(result['knowledge_graph']).toBeDefined();
      expect(result['people_also_ask']).toBeDefined();
      expect(result['related_searches']).toBeDefined();
    });

    it('sends POST to /search with X-API-KEY header', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test query' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://google.serper.dev/search');
      expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-test-key');
      expect(init.method).toBe('POST');
    });

    it('sends query as q in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'my search query' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['q']).toBe('my search query');
    });

    it('respects custom baseUrl', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createSerperExtension({ apiKey: 'test-key', baseUrl: 'https://custom.serper.dev' }, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.serper.dev/search');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'search').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, { message: 'Unauthorized' });
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: authentication failed'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: unexpected response format'
      );
    });

    it('maps unknown error with message [EC-7]', async () => {
      globalThis.fetch = mockFetchReject(new Error('Something went wrong'));
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: Something went wrong'
      );
    });

    it('emits success event on successful search [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:search',
          subsystem: 'extension:serper',
          query: 'TypeScript',
          result_count: 2,
        })
      );
    });

    it('emits error event on failed search [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'search').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:error',
          subsystem: 'extension:serper',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'serper: operation cancelled'
      );
    });
  });

  // ============================================================
  // news()
  // ============================================================

  describe('news()', () => {
    it('returns news results tuple [AC-3]', async () => {
      globalThis.fetch = mockFetchJson(200, NEWS_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'news').fn(
        { query: 'TypeScript news' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['news'])).toBe(true);
      expect((result['news'] as unknown[]).length).toBe(2);
    });

    it('sends POST to /news with q in body', async () => {
      const mockFetch = mockFetchJson(200, NEWS_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'news').fn({ query: 'latest TypeScript news' }, ctx);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://google.serper.dev/news');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['q']).toBe('latest TypeScript news');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'news').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: authentication failed'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Network error'));
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = mockFetchNonJson();
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: unexpected response format'
      );
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, NEWS_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'news').fn({ query: 'TypeScript news' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:news',
          subsystem: 'extension:serper',
          query: 'TypeScript news',
          result_count: 2,
        })
      );
    });

    it('emits error event on failure [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'news').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:error',
          subsystem: 'extension:serper',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'news').fn({ query: 'test' }, ctx),
        'serper: operation cancelled'
      );
    });
  });

  // ============================================================
  // images()
  // ============================================================

  describe('images()', () => {
    it('returns images tuple with expected fields [AC-4]', async () => {
      globalThis.fetch = mockFetchJson(200, IMAGES_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'images').fn(
        { query: 'TypeScript logo' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['images'])).toBe(true);
      expect((result['images'] as unknown[]).length).toBe(1);

      const first = (result['images'] as Record<string, unknown>[])[0]!;
      expect(first['title']).toBe('TypeScript Logo');
      expect(first['imageUrl']).toBe('https://images.example.com/ts-logo.png');
      expect(first['imageWidth']).toBe(400);
      expect(first['imageHeight']).toBe(400);
      expect(first['thumbnailUrl']).toBe('https://thumbs.example.com/ts-logo-thumb.png');
      expect(first['source']).toBe('typescriptlang.org');
      expect(first['link']).toBe('https://typescriptlang.org');
    });

    it('sends POST to /images with q in body', async () => {
      const mockFetch = mockFetchJson(200, IMAGES_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'images').fn({ query: 'TypeScript logo' }, ctx);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://google.serper.dev/images');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['q']).toBe('TypeScript logo');
    });

    it('throws RILL-R004 for empty query [EC-17, AC-16]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      {const __r = await getCallable(ext, 'images').fn({ query: '' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: authentication failed'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Network error'));
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = mockFetchNonJson();
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: unexpected response format'
      );
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, IMAGES_RESPONSE);
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'images').fn({ query: 'TypeScript logo' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:images',
          subsystem: 'extension:serper',
          query: 'TypeScript logo',
          result_count: 1,
        })
      );
    });

    it('emits error event on failure [AC-24]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn();
      ctx.callbacks.onLogEvent = onLogEvent;

      {const __r = await getCallable(ext, 'images').fn({ query: 'test' }, ctx) as RillValue; expect(isInvalid(__r)).toBe(true);}

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'serper:error',
          subsystem: 'extension:serper',
          error: expect.any(String),
        })
      );
    });

    it('throws operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'images').fn({ query: 'test' }, ctx),
        'serper: operation cancelled'
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

      const ext = createSerperExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      // Start search without awaiting — request stays in-flight
      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      // Dispose while request is in-flight
      await ext.dispose!();

      // The in-flight request should reject with mapped AbortError
      await expectInvalidWithMessage(promise, 'serper: request timeout');
    });
  });
});
