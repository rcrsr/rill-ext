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
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { createAnthropicExtension } from '../src/factory.js';

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', async () => {
  class MockAPIError extends Error {
    status: number;
    constructor(
      status: number,
      _error: unknown,
      message: string,
      _headers: unknown
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  const actual =
    await vi.importActual<typeof import('@anthropic-ai/sdk')>(
      '@anthropic-ai/sdk'
    );

  return {
    APIUserAbortError: actual.APIUserAbortError,
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

const CONFIG = {
  api_key: 'test-key',
  model: 'claude-sonnet-4-5-20250929',
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

/** Stream whose finalMessage stays pending until its signal aborts. */
function mockPendingStream(): void {
  mockStream.mockImplementation(
    (_params: unknown, options: { signal?: AbortSignal }) => {
      const stream = {
        on: vi.fn(() => stream),
        finalMessage: vi.fn(() => pendingUntilAborted(options.signal)),
        abort: vi.fn(),
        [Symbol.asyncIterator]: () => ({
          next: () => pendingUntilAborted(options.signal),
        }),
      };
      return stream;
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
  expect(status.provider).toBe('anthropic');
  expect((status.raw as Record<string, unknown>)['kind']).toBe(
    'extension_disposed'
  );
}

function makeRateLimitError(): Error {
  return new (APIError as unknown as new (
    status: number,
    error: unknown,
    message: string,
    headers: unknown
  ) => Error)(429, undefined, 'rate limited', undefined);
}

describe('dispose() with in-flight requests', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('message()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockPendingStream();
      const ext = createAnthropicExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });

    it('emits anthropic:error when dispose aborts the pending request', async () => {
      mockPendingStream();
      const ext = createAnthropicExtension(CONFIG);
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
        event: 'anthropic:error',
        subsystem: 'extension:anthropic',
        error: 'anthropic: extension disposed',
      });
    });

    it('throws DISPOSED from the chunk iterator when dispose aborts the stream', async () => {
      mockPendingStream();
      const ext = createAnthropicExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      ) as unknown as { next: ApplicationCallable };
      const settled = settleRejection(
        Promise.resolve(stream.next.fn({}, createRuntimeContext()))
      );

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('generate()', () => {
    it('throws DISPOSED when dispose aborts the pending request', async () => {
      mockCreate.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) =>
          pendingUntilAborted(options.signal)
      );
      const ext = createAnthropicExtension(CONFIG);
      const schema = {
        __rill_type: true,
        structure: {
          kind: 'dict',
          fields: { answer: { type: { kind: 'string' } } },
        },
      };
      const settled = settleRejection(
        Promise.resolve(
          getCallable(ext, 'generate').fn(
            { prompt: 'Hello', schema },
            createRuntimeContext()
          )
        )
      );

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('tool_loop()', () => {
    it('throws DISPOSED when dispose aborts the pending loop request', async () => {
      mockPendingStream();
      const ext = createAnthropicExtension(CONFIG);
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

    it('issues no further request after dispose during a tool call', async () => {
      let releaseTool: () => void = () => {};
      const toolStarted = new Promise<void>((resolve) => {
        mockStream.mockImplementation(() => {
          const response = {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'slow', input: {} },
            ],
            model: CONFIG.model,
            stop_reason: 'tool_use',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
          const stream = {
            on: vi.fn(() => stream),
            finalMessage: vi.fn(() => {
              resolve();
              return Promise.resolve(response);
            }),
            abort: vi.fn(),
          };
          return stream;
        });
      });
      const ext = createAnthropicExtension(CONFIG);
      const slow = callable(
        () =>
          new Promise<string>((resolve) => {
            releaseTool = () => resolve('done');
          })
      );
      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools: { slow } },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));
      await toolStarted;
      await vi.waitFor(() => {
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      await ext.dispose?.();
      releaseTool();
      const thrown = await settled;

      expectDisposedHalt(thrown);
      expect(mockStream).toHaveBeenCalledTimes(1);
    });
  });

  describe('tool_loop() with the SDK abort error', () => {
    it('throws DISPOSED when the pending request rejects with APIUserAbortError', async () => {
      mockStream.mockImplementation(
        (_params: unknown, options: { signal?: AbortSignal }) => {
          const stream = {
            on: vi.fn(() => stream),
            finalMessage: vi.fn(
              () =>
                new Promise<never>((_resolve, reject) => {
                  options.signal?.addEventListener('abort', () =>
                    reject(new APIUserAbortError())
                  );
                })
            ),
            abort: vi.fn(),
          };
          return stream;
        }
      );
      const ext = createAnthropicExtension(CONFIG);
      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Hello', tools: { noop: callable(() => 'ok') } },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();

      expectDisposedHalt(await settled);
    });
  });

  describe('error observed after dispose', () => {
    it('keeps the original atom when a non-abort error settles after dispose', async () => {
      let rejectRequest: (error: unknown) => void = () => {};
      mockStream.mockImplementation(() => {
        const stream = {
          on: vi.fn(() => stream),
          finalMessage: vi.fn(
            () =>
              new Promise<never>((_resolve, reject) => {
                rejectRequest = reject;
              })
          ),
          abort: vi.fn(),
        };
        return stream;
      });
      const ext = createAnthropicExtension(CONFIG);
      const stream = getCallable(ext, 'message').fn(
        { prompt: 'Hello' },
        createRuntimeContext()
      );
      const settled = settleRejection(resolveStream(stream));

      await ext.dispose?.();
      rejectRequest(makeRateLimitError());

      const thrown = await settled;
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.code as { name: string }).name).toBe('RATE_LIMIT');
    });
  });

  describe('stream dispose without extension dispose', () => {
    it('does not report DISPOSED for tool_loop', async () => {
      mockPendingStream();
      const ext = createAnthropicExtension(CONFIG);
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

      // The loop reports its own cancellation halt, not the #DISPOSED halt.
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.code as { name: string }).name).not.toBe('DISPOSED');
    });
  });
});
