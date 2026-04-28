/**
 * Function behavior tests for Tavily search extension.
 * Mocks global.fetch and verifies request/response handling.
 *
 * Errors and disposal both surface as invalid RillValues; the wrapped
 * function never throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
  type RillValue,
} from '@rcrsr/rill';
import { createTavilyExtension } from '../src/factory.js';

function makeFactoryCtx(signal?: AbortSignal): ExtensionFactoryCtx {
  return {
    signal: signal ?? new AbortController().signal,
    registerErrorCode: () => {},
  };
}

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
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

function mockFetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

function mockFetchReject(error: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(error);
}

function mockFetchNonJson(status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
  });
}

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

describe('Tavily extension host functions', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('search()', () => {
    it('returns results array [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'my search query' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['query']).toBe('my search query');
    });

    it('respects custom baseUrl', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createTavilyExtension(
        { apiKey: 'test-key', baseUrl: 'https://custom.tavily.com' },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.tavily.com/search');
    });

    it('includes optional answer field when present in response', async () => {
      const responseWithAnswer = { ...SEARCH_RESPONSE, answer: 'TypeScript is a typed language.' };
      globalThis.fetch = mockFetchJson(200, responseWithAnswer);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect(result['answer']).toBe('TypeScript is a typed language.');
    });

    it('returns invalid value for empty query [EC-17, AC-16]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: '' }, ctx),
        'query is required'
      );
    });

    it('maps HTTP 401 to authentication failed [EC-1, AC-17]', async () => {
      globalThis.fetch = mockFetchJson(401, { detail: 'Unauthorized' });
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: authentication failed'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: server error (500)'
      );
    });

    it('maps network TypeError to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: unexpected response format'
      );
    });

    it('maps Tavily 432 to plan limit exceeded [EC-9, AC-26]', async () => {
      globalThis.fetch = mockFetchJson(432, { detail: 'Plan limit' });
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: plan limit exceeded'
      );
    });

    it('maps Tavily 433 to pay-as-you-go limit exceeded [EC-10, AC-27]', async () => {
      globalThis.fetch = mockFetchJson(433, { detail: 'PAYG limit' });
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: pay-as-you-go limit exceeded'
      );
    });

    it('emits success event on successful search [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const onLogEvent = vi.fn();
      const ctx = createRuntimeContext({ callbacks: { onLogEvent } });

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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const onLogEvent = vi.fn();
      const ctx = createRuntimeContext({ callbacks: { onLogEvent } });

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:error',
          subsystem: 'extension:tavily',
          error: expect.any(String),
        })
      );
    });

    it('returns operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'tavily: operation cancelled'
      );
    });
  });

  describe('extract()', () => {
    it('returns results and failed_results [AC-5]', async () => {
      globalThis.fetch = mockFetchJson(200, EXTRACT_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: authentication failed'
      );
    });

    it('maps HTTP 429 to rate limit exceeded [EC-2, AC-18]', async () => {
      globalThis.fetch = mockFetchJson(429, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: rate limit exceeded'
      );
    });

    it('maps HTTP 500 to server error [EC-3, AC-20]', async () => {
      globalThis.fetch = mockFetchJson(500, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: server error (500)'
      );
    });

    it('maps network failure to connection failed [EC-5, AC-19]', async () => {
      globalThis.fetch = mockFetchReject(new TypeError('Network error'));
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: connection failed'
      );
    });

    it('maps AbortError to request timeout [EC-4, AC-21]', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      globalThis.fetch = mockFetchReject(abortErr);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: request timeout'
      );
    });

    it('maps non-JSON response to unexpected format [EC-6, AC-31]', async () => {
      globalThis.fetch = mockFetchNonJson();
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: unexpected response format'
      );
    });

    it('maps Tavily 432 to plan limit exceeded [EC-9, AC-26]', async () => {
      globalThis.fetch = mockFetchJson(432, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: plan limit exceeded'
      );
    });

    it('maps Tavily 433 to pay-as-you-go limit exceeded [EC-10, AC-27]', async () => {
      globalThis.fetch = mockFetchJson(433, {});
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: pay-as-you-go limit exceeded'
      );
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, EXTRACT_RESPONSE);
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const onLogEvent = vi.fn();
      const ctx = createRuntimeContext({ callbacks: { onLogEvent } });

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
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const onLogEvent = vi.fn();
      const ctx = createRuntimeContext({ callbacks: { onLogEvent } });

      await getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tavily:error',
          subsystem: 'extension:tavily',
          error: expect.any(String),
        })
      );
    });

    it('returns operation cancelled after dispose [EC-12, AC-23]', async () => {
      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await ext.dispose!();

      await expectInvalidWithMessage(
        getCallable(ext, 'extract').fn({ urls: ['https://example.com'] }, ctx),
        'tavily: operation cancelled'
      );
    });
  });

  describe('dispose with in-flight requests [AC-22]', () => {
    it('dispose cancels in-flight search request [AC-22]', async () => {
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

      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);
      await ext.dispose!();
      await expectInvalidWithMessage(promise, 'tavily: request timeout');
    });
  });

  describe('ctx.signal cancellation', () => {
    it('aborting ctx.signal cancels in-flight request', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const ext = createTavilyExtension(VALID_CONFIG, makeFactoryCtx());
      const controller = new AbortController();
      const ctx = createRuntimeContext({ signal: controller.signal });

      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);
      controller.abort();
      await expectInvalidWithMessage(promise, 'tavily: request timeout');
    });
  });
});
