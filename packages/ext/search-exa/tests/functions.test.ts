/**
 * Function behavior tests for Exa search extension.
 * Mocks global.fetch and verifies request/response handling.
 * Covers: AC-2, AC-5, AC-6, AC-7, AC-11, AC-16, AC-17, AC-18, AC-19, AC-20,
 *         AC-21, AC-22, AC-23, AC-24, AC-25, AC-31, AC-36, AC-38,
 *         EC-2, EC-3, EC-4, EC-5, EC-6, EC-8, EC-12, EC-17.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  RuntimeHaltSignal,
  type ApplicationCallable,
  type ExtensionEvent,
  type ExtensionFactoryCtx,
  type RillValue,
} from '@rcrsr/rill';
import { createExaExtension } from '../src/factory.js';

// ============================================================
// TEST HELPERS
// ============================================================

function makeFactoryCtx(signal?: AbortSignal): ExtensionFactoryCtx {
  return {
    signal: signal ?? new AbortController().signal,
    registerErrorCode: () => {},
  };
}

/** Run a call and return whatever it throws; fail if it does not throw. */
async function captureThrown(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e: unknown) {
    return e;
  }
  throw new Error('expected call to throw');
}

function expectDisposedThrown(thrown: unknown, provider: string): void {
  expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
  const signal = thrown as RuntimeHaltSignal;
  expect(signal.catchable).toBe(true);
  expect(isInvalid(signal.value)).toBe(true);
  const status = getStatus(signal.value);
  expect(status.code.name).toBe('DISPOSED');
  expect(status.raw['kind']).toBe('extension_disposed');
  expect(status.provider).toBe(provider);
}

async function expectDisposedThrow(
  call: () => unknown,
  provider: string
): Promise<void> {
  expectDisposedThrown(await captureThrown(call), provider);
}

async function expectInvalidWithMessage(
  promise: RillValue | Promise<RillValue>,
  code: string,
  needle: string
): Promise<RillValue> {
  const result = await promise;
  expect(isInvalid(result)).toBe(true);
  const status = getStatus(result);
  expect(status.code.name).toBe(code);
  expect(status.message).toContain(needle);
  return result;
}

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Build a fetch mock that returns a JSON response with given status. */
function mockFetchJson(status: number, body: unknown): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

// ============================================================
// FIXTURES
// ============================================================

const VALID_CONFIG = { apiKey: 'exa-test-key' };

const SEARCH_RESPONSE = {
  requestId: 'req-abc',
  results: [
    { id: 'r1', url: 'https://example.com/1', title: 'Result 1', score: 0.9 },
    { id: 'r2', url: 'https://example.com/2', title: 'Result 2', score: 0.8 },
  ],
};

const CONTENTS_RESPONSE = {
  results: [
    { id: 'c1', url: 'https://example.com/1', text: 'Page content here' },
  ],
  statuses: [{ url: 'https://example.com/1', status: 'success' }],
};

const FIND_SIMILAR_RESPONSE = {
  requestId: 'req-sim',
  results: [
    {
      id: 's1',
      url: 'https://similar.com/1',
      title: 'Similar page',
      score: 0.95,
    },
  ],
};

const ANSWER_RESPONSE = {
  answer: 'TypeScript is a typed superset of JavaScript.',
  citations: [
    { id: 'cit1', url: 'https://typescriptlang.org', title: 'TypeScript Docs' },
  ],
};

// ============================================================
// TESTS
// ============================================================

describe('Exa extension host functions', () => {
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
    it('returns results tuple [AC-2]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript tutorials' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect((result['results'] as unknown[]).length).toBe(2);
    });

    it('includes request_id when present in response [AC-38]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect(result['request_id']).toBe('req-abc');
    });

    it('omits request_id when absent in response [AC-38]', async () => {
      const responseWithoutId = { results: [{ url: 'https://example.com' }] };
      globalThis.fetch = mockFetchJson(200, responseWithoutId);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'search').fn(
        { query: 'TypeScript' },
        ctx
      )) as Record<string, unknown>;

      expect('request_id' in result).toBe(false);
    });

    it('sends POST to /search with x-api-key header', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test query' }, ctx);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.exa.ai/search');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(
        'exa-test-key'
      );
      expect(init.method).toBe('POST');
    });

    it('sends query in request body', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'my search query' }, ctx);

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['query']).toBe('my search query');
    });

    it('respects custom baseUrl', async () => {
      const mockFetch = mockFetchJson(200, SEARCH_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(
        { apiKey: 'test-key', baseUrl: 'https://custom.exa.ai' },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'search').fn({ query: 'test' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://custom.exa.ai/search');
    });

    it('returns invalid #INVALID_INPUT for empty query', async () => {
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: '' }, ctx),
        'INVALID_INPUT',
        'query is required'
      );
    });

    it('throws DISPOSED from every function without calling fetch', async () => {
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const fetchMock = mockFetchJson(200, {});
      globalThis.fetch = fetchMock;
      await ext.dispose!();

      const names = Object.keys(ext.value as Record<string, unknown>);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        await expectDisposedThrow(
          () => getCallable(ext, name).fn({}, ctx),
          'exa'
        );
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 401 to #AUTH authentication failed', async () => {
      globalThis.fetch = mockFetchJson(401, { error: 'Unauthorized' });
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'AUTH',
        'exa: authentication failed'
      );
    });

    it('emits success event on successful search [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, SEARCH_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn<(event: ExtensionEvent) => void>();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'search').fn({ query: 'TypeScript' }, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'exa:search',
          subsystem: 'extension:exa',
          query: 'TypeScript',
          result_count: 2,
        })
      );
    });
  });

  // ============================================================
  // contents()
  // ============================================================

  describe('contents()', () => {
    it('returns results and statuses [AC-5]', async () => {
      globalThis.fetch = mockFetchJson(200, CONTENTS_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'contents').fn(
        { urls: ['https://example.com/1'] },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect(Array.isArray(result['statuses'])).toBe(true);
    });

    it('omits statuses when not in response [AC-38]', async () => {
      const responseWithoutStatuses = {
        results: [{ url: 'https://example.com/1', text: 'content' }],
      };
      globalThis.fetch = mockFetchJson(200, responseWithoutStatuses);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'contents').fn(
        { urls: ['https://example.com/1'] },
        ctx
      )) as Record<string, unknown>;

      expect('statuses' in result).toBe(false);
    });

    it('sends POST to /contents with urls', async () => {
      const mockFetch = mockFetchJson(200, CONTENTS_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'contents').fn(
        { urls: ['https://example.com/1', 'https://example.com/2'] },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.exa.ai/contents');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['urls']).toEqual([
        'https://example.com/1',
        'https://example.com/2',
      ]);
    });

    it('handles mixed URL partial results [AC-36]', async () => {
      const mixedResponse = {
        results: [{ url: 'https://example.com/1', text: 'content' }],
        statuses: [
          { url: 'https://example.com/1', status: 'success' },
          {
            url: 'https://example.com/bad',
            status: 'error',
            error: 'Not found',
          },
        ],
      };
      globalThis.fetch = mockFetchJson(200, mixedResponse);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'contents').fn(
        { urls: ['https://example.com/1', 'https://example.com/bad'] },
        ctx
      )) as Record<string, unknown>;

      expect((result['results'] as unknown[]).length).toBe(1);
      expect((result['statuses'] as unknown[]).length).toBe(2);
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, CONTENTS_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn<(event: ExtensionEvent) => void>();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'contents').fn(
        { urls: ['https://example.com/1'] },
        ctx
      );

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'exa:contents',
          subsystem: 'extension:exa',
        })
      );
    });
  });

  // ============================================================
  // find_similar()
  // ============================================================

  describe('find_similar()', () => {
    it('returns search-shape dict with results [AC-6]', async () => {
      globalThis.fetch = mockFetchJson(200, FIND_SIMILAR_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'find_similar').fn(
        { url: 'https://example.com/source' },
        ctx
      )) as Record<string, unknown>;

      expect(Array.isArray(result['results'])).toBe(true);
      expect((result['results'] as unknown[]).length).toBe(1);
    });

    it('includes request_id when present in response [AC-38]', async () => {
      globalThis.fetch = mockFetchJson(200, FIND_SIMILAR_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'find_similar').fn(
        { url: 'https://example.com/source' },
        ctx
      )) as Record<string, unknown>;

      expect(result['request_id']).toBe('req-sim');
    });

    it('sends POST to /findSimilar with url', async () => {
      const mockFetch = mockFetchJson(200, FIND_SIMILAR_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'find_similar').fn(
        { url: 'https://example.com/source' },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.exa.ai/findSimilar');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['url']).toBe('https://example.com/source');
    });

    it('emits success event on success [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, FIND_SIMILAR_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn<(event: ExtensionEvent) => void>();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'find_similar').fn(
        { url: 'https://example.com/source' },
        ctx
      );

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'exa:find_similar',
          subsystem: 'extension:exa',
        })
      );
    });
  });

  // ============================================================
  // answer()
  // ============================================================

  describe('answer()', () => {
    it('returns answer string and citations [AC-7]', async () => {
      globalThis.fetch = mockFetchJson(200, ANSWER_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'answer').fn(
        { query: 'What is TypeScript?' },
        ctx
      )) as Record<string, unknown>;

      expect(typeof result['answer']).toBe('string');
      expect(result['answer']).toBe(
        'TypeScript is a typed superset of JavaScript.'
      );
      expect(Array.isArray(result['citations'])).toBe(true);
    });

    it('sends POST to /answer with query', async () => {
      const mockFetch = mockFetchJson(200, ANSWER_RESPONSE);
      globalThis.fetch = mockFetch;
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'answer').fn(
        { query: 'What is TypeScript?' },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.exa.ai/answer');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['query']).toBe('What is TypeScript?');
    });

    it('returns invalid #INVALID_INPUT for empty query', async () => {
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await expectInvalidWithMessage(
        getCallable(ext, 'answer').fn({ query: '' }, ctx),
        'INVALID_INPUT',
        'query is required'
      );
    });

    it('emits success event with result_count = citations length [AC-11]', async () => {
      globalThis.fetch = mockFetchJson(200, ANSWER_RESPONSE);
      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const onLogEvent = vi.fn<(event: ExtensionEvent) => void>();
      ctx.callbacks.onLogEvent = onLogEvent;

      await getCallable(ext, 'answer').fn(
        { query: 'What is TypeScript?' },
        ctx
      );

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'exa:answer',
          subsystem: 'extension:exa',
          result_count: 1,
        })
      );
    });
  });

  // ============================================================
  // dispose with in-flight requests
  // ============================================================

  describe('dispose with in-flight requests', () => {
    it('throws DISPOSED for an in-flight search aborted by dispose', async () => {
      globalThis.fetch = vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        });

      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);
      await ext.dispose!();

      await expectDisposedThrow(() => promise, 'exa');
    });

    it('keeps its own code for a non-abort error that settles after dispose', async () => {
      globalThis.fetch = vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('socket hang up'));
            });
          });
        });

      const ext = createExaExtension(VALID_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const promise = getCallable(ext, 'search').fn({ query: 'test' }, ctx);
      await ext.dispose!();

      const result = await promise;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
    });
  });
});
