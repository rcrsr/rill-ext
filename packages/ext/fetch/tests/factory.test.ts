/**
 * Tests for fetch extension factory.
 *
 * Covers factory creation, dynamic function generation, introspection,
 * argument processing, and dispose lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getStatus, type ApplicationCallable } from '@rcrsr/rill';
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
};

let mockResponses: MockResponse[] = [];
let fetchCallCount = 0;

function mockFetch(
  _url: string,
  options?: { signal?: AbortSignal }
): Promise<Response> {
  fetchCallCount++;

  const mockResponse = mockResponses.shift();
  if (!mockResponse) {
    throw new TypeError('Network error: no mock response');
  }

  const delay = mockResponse.delay ?? 0;
  const signal = options?.signal;

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
  describe('factory creation', () => {
    it('creates ExtensionFactoryResult with endpoint functions', () => {
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

      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
      expect(getCallable(ext, 'getUser')).toBeDefined();
      expect(getCallable(ext, 'endpoints')).toBeDefined();
    });

    it('creates function for each endpoint in config', () => {
      const config: FetchExtensionConfig = {
        baseUrl: 'https://api.example.com',
        endpoints: {
          getUser: {
            method: 'GET',
            path: '/users/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
          createPost: {
            method: 'POST',
            path: '/posts',
            params: [{ name: 'title', type: 'string', location: 'body' }],
          },
          deleteComment: {
            method: 'DELETE',
            path: '/comments/:id',
            params: [{ name: 'id', type: 'string', location: 'path' }],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      expect(getCallable(ext, 'getUser')).toBeDefined();
      expect(getCallable(ext, 'createPost')).toBeDefined();
      expect(getCallable(ext, 'deleteComment')).toBeDefined();
    });

    it('applies default config values without throwing', () => {
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
      expect(ext).toBeDefined();
    });

    it('each host function has a callable fn', () => {
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
      expect(typeof getCallable(ext, 'getUser').fn).toBe('function');
    });

    it('each host function has params array', () => {
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
      expect(Array.isArray(getCallable(ext, 'getUser').params)).toBe(true);
    });
  });

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

      await expect(
        getCallable(ext, 'listUsers').fn({}, makeRuntimeCtx())
      ).resolves.toBeDefined();
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

      await expect(
        getCallable(ext, 'listUsers').fn({}, makeRuntimeCtx())
      ).resolves.toBeDefined();
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
              { name: 'title', type: 'string', location: 'body' },
              { name: 'body', type: 'string', location: 'body' },
            ],
          },
        },
      };

      const ext = createFetchExtension(config, makeFactoryCtx());

      const result = await getCallable(ext, 'createPost').fn(
        { title: 'Test Post', body: 'Post content' },
        makeRuntimeCtx()
      );

      expect(result).toEqual({ id: 1, title: 'Test Post' });
    });
  });

  describe('response handling', () => {
    it('returns response body by default', async () => {
      mockResponses.push({
        status: 200,
        body: '{"id":123,"name":"Test"}',
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

      const result = await getCallable(ext, 'getUser').fn(
        { id: '123' },
        makeRuntimeCtx()
      );

      expect(result).toEqual({ id: 123, name: 'Test' });
    });

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

      expect(result).toHaveProperty('status', 200);
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
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

      expect(result).toHaveProperty('status', 200);
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
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
    it('provides dispose method', () => {
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

      expect(ext).toHaveProperty('dispose');
      expect(typeof ext.dispose).toBe('function');
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

      expect(() => ext.dispose()).not.toThrow();
      expect(() => ext.dispose()).not.toThrow();
      expect(() => ext.dispose()).not.toThrow();
    });

    it('dispose aborts in-flight requests', async () => {
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
      ext.dispose();

      const result = await requestPromise;
      const status = getStatus(result);
      expect(status.code.name).toBe('TIMEOUT');
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

  describe('URL access control', () => {
    it('only exposes endpoints defined in config', () => {
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
      const value = ext.value as Record<string, unknown>;

      expect(value['getUser']).toBeDefined();
      expect(value['getPost']).toBeUndefined();
      expect(value['fetch']).toBeUndefined();
      expect(value['request']).toBeUndefined();
    });
  });
});
