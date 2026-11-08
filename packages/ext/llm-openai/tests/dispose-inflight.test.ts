/**
 * In-flight requests cancelled by dispose() report #DISPOSED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  callable,
  createRuntimeContext,
  getStatus,
  RuntimeHaltSignal,
  type ApplicationCallable,
} from '@rcrsr/rill';
import { APIError, APIUserAbortError } from 'openai';
import { createOpenAIExtension } from '../src/factory.js';

const mockStream = vi.fn();
const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', async () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(status: number | undefined, _error: unknown, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  const actual = await vi.importActual<typeof import('openai')>('openai');

  return {
    APIUserAbortError: actual.APIUserAbortError,
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn(),
          stream: mockStream,
        },
      };
      embeddings = {
        create: mockEmbeddingsCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

const CONFIG = {
  api_key: 'test-key',
  model: 'gpt-4-turbo',
  embed_model: 'text-embedding-3-small',
};

function abortError(): Error {
  const error = new Error('Request was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Reject with an abort error when the signal aborts; never resolve otherwise. */
function pendingUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(abortError()));
  });
}

/** Stream runner whose finalChatCompletion stays pending until its signal aborts. */
function mockPendingRunner(): void {
  mockStream.mockImplementation(
    (_params: unknown, options: { signal?: AbortSignal }) => {
      const runner = {
        on: vi.fn(() => runner),
        finalChatCompletion: vi.fn(() => pendingUntilAborted(options.signal)),
        abort: vi.fn(),
      };
      return runner;
    }
  );
}

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
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

function expectDisposedHalt(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
  const status = getStatus((thrown as RuntimeHaltSignal).value);
  expect((status.code as { name: string }).name).toBe('DISPOSED');
  expect(status.provider).toBe('openai');
  expect((status.raw as Record<string, unknown>)['kind']).toBe(
    'extension_disposed'
  );
}

describe('dispose() with in-flight requests', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockEmbeddingsCreate.mockReset();
  });

  describe('message()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockPendingRunner();
      const ext = createOpenAIExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });

    it('emits openai:error when dispose aborts the pending request', async () => {
      mockPendingRunner();
      const ext = createOpenAIExtension(CONFIG);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: () => {},
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });
      const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();
      await settled;

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'openai:error',
        subsystem: 'extension:openai',
        error: 'openai: extension disposed',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });

  describe('tool_loop()', () => {
    it('throws DISPOSED through the halt pass-through when dispose aborts the loop', async () => {
      mockPendingRunner();
      const ext = createOpenAIExtension(CONFIG);
      const stream = getCallable(ext, 'tool_loop').fn(
        {
          prompt: 'Hello',
          tools: { noop: callable(() => 'ok') },
        },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('tool_loop() with the SDK abort error', () => {
    it('throws DISPOSED when the pending request rejects with APIUserAbortError', async () => {
      mockStream.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) => {
          const runner = {
            on: vi.fn(() => runner),
            finalChatCompletion: vi.fn(
              () =>
                new Promise<never>((_resolve, reject) => {
                  options.signal?.addEventListener('abort', () =>
                    reject(new APIUserAbortError())
                  );
                })
            ),
            abort: vi.fn(),
          };
          return runner;
        }
      );
      const ext = createOpenAIExtension(CONFIG);
      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools: { noop: callable(() => 'ok') } },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('embed()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockEmbeddingsCreate.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) =>
          pendingUntilAborted(options.signal)
      );
      const ext = createOpenAIExtension(CONFIG);
      const settled = settleRejection(
        Promise.resolve(
          getCallable(ext, 'embed').fn(
            { text: 'hello' },
            createRuntimeContext()
          )
        )
      );

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('error observed after dispose', () => {
    it('keeps the original atom when a non-abort error settles after dispose', async () => {
      let rejectRequest: (error: unknown) => void = () => {};
      mockStream.mockImplementation(() => {
        const runner = {
          on: vi.fn(() => runner),
          finalChatCompletion: vi.fn(
            () =>
              new Promise<never>((_resolve, reject) => {
                rejectRequest = reject;
              })
          ),
          abort: vi.fn(),
        };
        return runner;
      });
      const ext = createOpenAIExtension(CONFIG);
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

      const thrown = await settled;
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.code as { name: string }).name).toBe('RATE_LIMIT');
    });
  });

  describe('stream dispose without extension dispose', () => {
    it('aborts the runner and does not report DISPOSED', async () => {
      const abort = vi.fn();
      let rejectPending: (error: Error) => void = () => {};
      mockStream.mockImplementation(() => ({
        on: vi.fn(),
        finalChatCompletion: vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              rejectPending = reject;
            })
        ),
        abort: abort.mockImplementation(() => rejectPending(abortError())),
      }));
      const ext = createOpenAIExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      (
        stream as unknown as { __rill_stream_dispose: () => void }
      ).__rill_stream_dispose();
      const thrown = await settled;

      expect(abort).toHaveBeenCalledTimes(1);
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.code as { name: string }).name).not.toBe('DISPOSED');
    });

    it('aborts the tool loop and does not report DISPOSED for tool_loop', async () => {
      mockPendingRunner();
      const ext = createOpenAIExtension(CONFIG);
      const stream = getCallable(ext, 'tool_loop').fn(
        {
          prompt: 'Hello',
          tools: { noop: callable(() => 'ok') },
        },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      (
        stream as unknown as { __rill_stream_dispose: () => void }
      ).__rill_stream_dispose();
      const thrown = await settled;

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.code as { name: string }).name).not.toBe('DISPOSED');
    });
  });
});
