/**
 * Tests for fetch extension factory.
 *
 * Covers factory creation, dynamic function generation, introspection,
 * argument processing, and dispose lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  RuntimeHaltSignal,
  type ApplicationCallable,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  createFetchExtension,
  type FetchExtensionConfig,
} from '../src/index.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

// ============================================================
// MOCK FETCH
// ============================================================

type MockResponse = {
  status: number;
  headers?: Record<string, string> | undefined;
  body: string;
  delay?: number | undefined;
  // Resolve after `delay` even when the signal aborts, simulating a response
  // that completed while dispose() ran.
  ignoreAbort?: boolean | undefined;
};

let mockResponses: MockResponse[] = [];
let fetchCallCount = 0;
let requestedUrls: string[] = [];
let requestedInits: Array<{ method?: string; body?: string } | undefined> = [];

function mockFetch(
  _url: string,
  options?: { signal?: AbortSignal; method?: string; body?: string }
): Promise<Response> {
  fetchCallCount++;
  requestedUrls.push(_url);
  requestedInits.push(options);

  const mockResponse = mockResponses.shift();
  if (!mockResponse) {
    throw new TypeError('Network error: no mock response');
  }

  const delay = mockResponse.delay ?? 0;
  const signal =
    mockResponse.ignoreAbort === true ? undefined : options?.signal;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortError = new Error('AbortError: The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
      return;
    }

    const abortHandler = () => {
      const abortError = new Error('AbortError: The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    };

    signal?.addEventListener('abort', abortHandler);

    setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);

      const headers = new Headers(mockResponse.headers ?? {});
      const response = {
        ok: mockResponse.status >= 200 && mockResponse.status < 300,
        status: mockResponse.status,
        headers,
        text: async () => mockResponse.body,
        json: async () => JSON.parse(mockResponse.body) as unknown,
      } as Response;

      resolve(response);
    }, delay);
  });
}

beforeEach(() => {
  mockResponses = [];
  fetchCallCount = 0;
  requestedUrls = [];
  requestedInits = [];
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// TESTS
// ============================================================

describe('createFetchExtension', () => {
  describe('endpoints() introspection', () => {
    it('returns list with name, method, path, description', async () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            description: 'Get user by ID',
          },
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [{ name: 'title', type: 'string', location: 'body' }],
            description: 'Create new post',
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const result = (await getCallable(ext, 'endpoints').fn(
        {},
        makeRuntimeCtx()
      )) as Array<{
        name: string;
        method: string;
        path: string;
        description: string;
      }>;

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'getUser',
        method: 'GET',
        path: '/users/:id',
        description: 'Get user by ID',
      });
      expect(result[1]).toEqual({
        name: 'createPost',
        method: 'POST',
        path: '/posts',
        description: 'Create new post',
      });
    });

    it('returns empty description for endpoints without description', async () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const result = (await getCallable(ext, 'endpoints').fn(
        {},
        makeRuntimeCtx()
      )) as Array<{
        description: string;
      }>;

      expect(result[0]).toMatchObject({ description: '' });
    });
  });

  describe('missing required parameter', () => {
    it('returns #INVALID_INPUT when required parameter is missing', async () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'getUser').fn({}, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toContain('parameter "id" is required');
    });

    it('returns #INVALID_INPUT when one of multiple required parameters is missing', async () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          createUser: {
            method: 'POST',
            path: '/users',
            params: [
              { name: 'name', type: 'string', location: 'body' },
              { name: 'email', type: 'string', location: 'body' },
            ],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'createUser').fn(
        { name: 'John' },
        makeRuntimeCtx()
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toContain('parameter "email" is required');
    });

    it('does not throw when optional parameter with defaultValue is missing', async () => {
      mockResponses.push({ status: 200, body: '{"users":[]}' });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          listUsers: {
            method: 'GET',
            path: '/users',
            params: [
              {
                name: 'limit',
                type: 'number',
                location: 'query',
                defaultValue: 10,
              },
            ],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'listUsers').fn(
        {},
        makeRuntimeCtx()
      );

      expect(isInvalid(result)).toBe(false);
      expect(requestedUrls).toHaveLength(1);
      expect(new URL(requestedUrls[0]!).searchParams.get('limit')).toBe('10');
    });

    it('does not throw when parameter has required: false', async () => {
      mockResponses.push({ status: 200, body: '{"users":[]}' });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          listUsers: {
            method: 'GET',
            path: '/users',
            params: [
              {
                name: 'filter',
                type: 'string',
                location: 'query',
                required: false,
              },
            ],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'listUsers').fn(
        {},
        makeRuntimeCtx()
      );

      expect(isInvalid(result)).toBe(false);
      expect(requestedUrls).toHaveLength(1);
      expect(new URL(requestedUrls[0]!).searchParams.has('filter')).toBe(false);
    });
  });

  describe('endpoint invocation', () => {
    it('calls endpoint with named arguments', async () => {
      mockResponses.push({ status: 200, body: '{"id":123,"name":"John"}' });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      expect(result).toEqual({ id: 123, name: 'John' });
      expect(fetchCallCount).toBe(1);
      expect(requestedUrls).toEqual(['https://api.example.com/users/123']);
    });

    it('processes multiple parameters', async () => {
      mockResponses.push({
        status: 201,
        body: '{"id":1,"title":"Test Post"}',
      });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [
              { name: 'category', type: 'string', location: 'query' },
              { name: 'title', type: 'string', location: 'body' },
            ],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'createPost').fn(
        { category: 'news', title: 'Test Post' },
        makeRuntimeCtx()
      );

      expect(result).toEqual({ id: 1, title: 'Test Post' });
      expect(requestedUrls).toEqual([
        'https://api.example.com/posts?category=news',
      ]);
      expect(requestedInits[0]?.method).toBe('POST');
      expect(JSON.parse(requestedInits[0]!.body!)).toBe('Test Post');
    });
  });

  describe('response handling', () => {
    it('returns full response when responseShape is full', async () => {
      mockResponses.push({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"id":123}',
      });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            responseShape: 'full',
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      expect(result).toMatchObject({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: 123 },
      });
    });

    it('applies global responseShape to endpoints without explicit shape', async () => {
      mockResponses.push({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"id":123}',
      });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        responseShape: 'full',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            // no responseShape set — should inherit global 'full'
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      expect(result).toMatchObject({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: 123 },
      });
    });

    it('endpoint responseShape overrides global responseShape', async () => {
      mockResponses.push({
        status: 200,
        body: '{"id":123}',
      });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        responseShape: 'full',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
            responseShape: 'body',
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      expect(result).toEqual({ id: 123 });
    });
  });

  describe('dispose()', () => {
    it('throws DISPOSED from every function after dispose', async () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
          listPosts: { method: 'GET', path: '/posts' },
        },
      };
      const ext = createFetchExtension(config, makeFactoryCtx());
      await ext.dispose!();
      await ext.dispose!();

      const names = Object.keys(ext.value as object);
      expect(names).toEqual(
        expect.arrayContaining(['getUser', 'listPosts', 'endpoints'])
      );
      for (const name of names) {
        let thrown: unknown;
        let resolved = false;
        try {
          await getCallable(ext, name).fn({ id: '1' }, makeRuntimeCtx());
          resolved = true;
        } catch (e) {
          thrown = e;
        }
        expect(resolved).toBe(false);
        expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
        expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
        const invalid = (thrown as RuntimeHaltSignal).value;
        expect(isInvalid(invalid)).toBe(true);
        const status = getStatus(invalid);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.provider).toBe('fetch');
        expect(status.raw['kind']).toBe('extension_disposed');
      }
      expect(fetchCallCount).toBe(0);
    });

    it('dispose can be called multiple times without error', () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const dispose = ext.dispose;
      expect(dispose).toBeDefined();

      expect(() => dispose!()).not.toThrow();
      expect(() => dispose!()).not.toThrow();
      expect(() => dispose!()).not.toThrow();
    });

    it('throws DISPOSED for in-flight requests aborted by dispose', async () => {
      mockResponses.push({ status: 200, body: '{"id":123}', delay: 500 });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const requestPromise = getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      // Abort all in-flight requests via dispose
      expect(ext.dispose).toBeDefined();
      ext.dispose!();

      const thrown = await Promise.resolve(requestPromise).catch(
        (e: unknown) => e
      );
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.provider).toBe('fetch');
      expect(status.raw).toMatchObject({ kind: 'extension_disposed' });
    });

    it('throws DISPOSED for a call queued on the concurrency limit', async () => {
      mockResponses.push({ status: 200, body: '{"id":1}', delay: 5_000 });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        maxConcurrent: 1,
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const running = Promise.resolve(
        getCallable(ext, 'getUser').fn({ id: '1' }, makeRuntimeCtx())
      ).catch((e: unknown) => e);
      const queued = Promise.resolve(
        getCallable(ext, 'getUser').fn({ id: '2' }, makeRuntimeCtx())
      ).catch((e: unknown) => e);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(fetchCallCount).toBe(1);

      const started = Date.now();
      ext.dispose!();
      const [runningResult, queuedResult] = await Promise.all([
        running,
        queued,
      ]);

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(fetchCallCount).toBe(1);
      for (const thrown of [runningResult, queuedResult]) {
        expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
        expect(getStatus((thrown as RuntimeHaltSignal).value).code.name).toBe(
          'DISPOSED'
        );
      }
    });

    it('throws DISPOSED without waiting out the retry backoff', async () => {
      mockResponses.push({ status: 503, body: 'unavailable' });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        retries: 1,
        retryDelay: 60_000,
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const requestPromise = getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );
      // Let the 503 resolve so the call is inside the backoff sleep.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
      ext.dispose!();

      const started = Date.now();
      const thrown = await Promise.resolve(requestPromise).catch(
        (e: unknown) => e
      );
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expect(getStatus((thrown as RuntimeHaltSignal).value).code.name).toBe(
        'DISPOSED'
      );
    });

    it('keeps the original atom when a response fails while dispose runs', async () => {
      mockResponses.push({
        status: 404,
        body: '{"error":"missing"}',
        delay: 50,
        ignoreAbort: true,
      });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());
      const requestPromise = getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );
      ext.dispose!();

      const status = getStatus(await requestPromise);
      expect(status.code.name).toBe('NOT_FOUND');
      expect(status.raw['kind']).not.toBe('extension_disposed');
    });

    it('aborts when ctx.signal fires', async () => {
      mockResponses.push({ status: 200, body: '{"id":123}', delay: 500 });

      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const ctrl = new AbortController();
      const runCtx = makeRuntimeCtx();
      // Override signal field
      Object.defineProperty(runCtx, 'signal', {
        value: ctrl.signal,
        configurable: true,
      });

      const requestPromise = getCallable(ext, 'getUser').fn(
        { id: '123' },
        runCtx
      );
      ctrl.abort();

      const result = await requestPromise;
      const status = getStatus(result);
      expect(status.code.name).toBe('TIMEOUT');
    });
  });
});

describe('fetch extension - runtime dispatch after dispose', () => {
  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = createFetchExtension(
      {
        baseUrl: 'https://api.example.com',
        endpoints: { listPosts: { method: 'GET', path: '/posts' } },
      },
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext({
      functions: { endpoints: getCallable(ext, 'endpoints') },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('endpoints()'), ctx).catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const ctx = await mountDisposed();

    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { endpoints() }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
