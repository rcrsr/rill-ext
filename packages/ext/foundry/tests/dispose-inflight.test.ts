/**
 * In-flight requests cancelled by dispose() report #DISPOSED; errors that
 * happened before dispose keep their original atom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  RuntimeHaltSignal,
  type ApplicationCallable,
} from '@rcrsr/rill';
import { APIError } from 'openai';
import { createFoundryExtension } from '../src/factory.js';
import type { FoundryConfig } from '../src/types.js';

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockEmbeddingsCreate = vi.fn();
const mockResponsesCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(status: number | undefined, _error: unknown, message: string) {
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
    responses = {
      create: mockResponsesCreate,
    };
    static APIError = MockAPIError;
  }

  return {
    AzureOpenAI: MockAzureOpenAI,
    APIError: MockAPIError,
  };
});

const CONFIG: FoundryConfig = {
  endpoint: 'https://my-foundry.openai.azure.com',
  auth: { type: 'api-key', key: 'test-key' },
  inference: {
    model: 'gpt-4o',
    apiVersion: '2025-01-01-preview',
    embedModel: 'text-embedding-3-small',
  },
};

const REST_CONFIG: FoundryConfig = {
  ...CONFIG,
  contentSafety: {
    endpoint: 'https://my-safety.cognitiveservices.azure.com',
  },
  grounding: { connectionId: '/connections/bing' },
  search: {
    endpoint: 'https://my-search.search.windows.net',
    indexName: 'my-index',
    apiKey: 'search-api-key',
  },
};

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function abortError(): Error {
  const error = new Error('Request was aborted.');
  error.name = 'AbortError';
  return error;
}

function pendingUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(abortError()));
  });
}

function resolveStream(stream: unknown): Promise<unknown> {
  const resolve = (stream as { __rill_stream_resolve: () => Promise<unknown> })
    .__rill_stream_resolve;
  return resolve();
}

async function settleRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected promise to reject');
}

function expectCode(thrown: unknown, code: string): void {
  expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
  const status = getStatus((thrown as RuntimeHaltSignal).value);
  expect(status.code.name).toBe(code);
  expect(status.provider).toBe('foundry');
}

let originalFetch: typeof globalThis.fetch;

/** Replace fetch with a request that stays pending until its signal aborts. */
function mockPendingFetch(): void {
  globalThis.fetch = vi.fn<typeof fetch>((_url, init) =>
    pendingUntilAborted(init?.signal ?? undefined)
  );
}

describe('dispose() with in-flight requests', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
    mockEmbeddingsCreate.mockReset();
    mockResponsesCreate.mockReset();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('message()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockStream.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) => {
          const runner = {
            finalChatCompletion: vi.fn(() =>
              pendingUntilAborted(options.signal)
            ),
            abort: vi.fn(),
          };
          return runner;
        }
      );
      const ext = await createFoundryExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      const thrown = await settled;
      expectCode(thrown, 'DISPOSED');
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.raw['kind']).toBe('extension_disposed');
    });

    it('keeps the original atom when a non-abort error settles after dispose', async () => {
      let rejectRequest: (error: unknown) => void = () => {};
      mockStream.mockImplementation(() => ({
        finalChatCompletion: vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              rejectRequest = reject;
            })
        ),
        abort: vi.fn(),
      }));
      const ext = await createFoundryExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();
      rejectRequest(
        new (APIError as unknown as new (
          status: number,
          error: unknown,
          message: string
        ) => Error)(429, undefined, 'rate limited')
      );

      expectCode(await settled, 'RATE_LIMIT');
    });
  });

  describe('embed()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockEmbeddingsCreate.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) =>
          pendingUntilAborted(options.signal)
      );
      const ext = await createFoundryExtension(CONFIG);
      const pending = settleRejection(
        Promise.resolve(
          getCallable(ext, 'embed').fn(
            { text: 'hello' },
            createRuntimeContext()
          )
        )
      );

      await ext.dispose?.();

      expectCode(await pending, 'DISPOSED');
    });
  });

  describe('shield()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockPendingFetch();
      const ext = await createFoundryExtension(REST_CONFIG);
      const pending = settleRejection(
        Promise.resolve(
          getCallable(ext, 'shield').fn(
            { text: 'hello', documents: [] },
            createRuntimeContext()
          )
        )
      );

      await ext.dispose?.();

      expectCode(await pending, 'DISPOSED');
    });

    it('keeps the original atom when a non-abort error settles after dispose', async () => {
      let rejectRequest: (error: unknown) => void = () => {};
      globalThis.fetch = vi.fn<typeof fetch>(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectRequest = reject;
          })
      );
      const ext = await createFoundryExtension(REST_CONFIG);
      const pending = settleRejection(
        Promise.resolve(
          getCallable(ext, 'shield').fn(
            { text: 'hello', documents: [] },
            createRuntimeContext()
          )
        )
      );

      await ext.dispose?.();
      rejectRequest(new TypeError('fetch failed'));

      expectCode(await pending, 'UNAVAILABLE');
    });
  });

  describe('search()', () => {
    it('throws DISPOSED and emits foundry:search:error when dispose aborts the pending request', async () => {
      mockPendingFetch();
      const ext = await createFoundryExtension(REST_CONFIG);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: () => {},
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });
      const pending = settleRejection(
        Promise.resolve(getCallable(ext, 'search').fn({ query: 'q' }, ctx))
      );

      await ext.dispose?.();

      expectCode(await pending, 'DISPOSED');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'foundry:search:error',
        error: 'foundry: extension disposed',
      });
    });
  });

  describe('ctx.signal cancellation', () => {
    it('cancels a pending search request without reporting DISPOSED', async () => {
      mockPendingFetch();
      const ext = await createFoundryExtension(REST_CONFIG);
      const controller = new AbortController();
      const ctx = createRuntimeContext({ signal: controller.signal });
      const pending = settleRejection(
        Promise.resolve(getCallable(ext, 'search').fn({ query: 'q' }, ctx))
      );

      controller.abort();
      const thrown = await pending;

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.code.name).not.toBe('DISPOSED');
    });
  });

  describe('ground()', () => {
    it('throws DISPOSED and emits foundry:ground:error when dispose aborts the pending request', async () => {
      mockResponsesCreate.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) =>
          pendingUntilAborted(options.signal)
      );
      const ext = await createFoundryExtension(REST_CONFIG);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: () => {},
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });
      const pending = settleRejection(
        Promise.resolve(getCallable(ext, 'ground').fn({ query: 'q' }, ctx))
      );

      await ext.dispose?.();

      expectCode(await pending, 'DISPOSED');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'foundry:ground:error',
        error: 'foundry: extension disposed',
      });
    });
  });
});
