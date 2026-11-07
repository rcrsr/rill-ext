/**
 * In-flight requests cancelled by dispose() report #DISPOSED; errors that
 * happened before dispose keep their original atom.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('dispose() with in-flight requests', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
    mockEmbeddingsCreate.mockReset();
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
});
