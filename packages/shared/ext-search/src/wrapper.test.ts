/**
 * Test suite for search function wrapper factory.
 *
 * Operation errors surface as invalid RillValues; a call after dispose, and
 * an abort-shaped in-flight failure on a disposed extension, throw a
 * catchable halt signal wrapping the invalid DISPOSED value.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createSearchFunctionWrapper } from './wrapper.js';
import { createDisposalState } from './disposal.js';
import { createInFlightState, abortAll } from './request.js';

// Pre-registered generic atoms for use in shared tests.

function makeCtx(opts?: {
  signal?: AbortSignal;
  onLogEvent?: (e: unknown) => void;
}): RuntimeContext {
  return createRuntimeContext({
    ...(opts?.signal ? { signal: opts.signal } : {}),
    callbacks: { onLogEvent: opts?.onLogEvent ?? (() => {}) },
  });
}

async function captureThrown(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (e: unknown) {
    return e;
  }
  throw new Error('expected call to throw');
}

describe('createSearchFunctionWrapper', () => {
  const provider = 'testsearch';

  describe('disposal check', () => {
    it('throws invalid DISPOSED value when disposed before call', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      disposalState.isDisposed = true;

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const fn = vi.fn(async () => ({
        result: 'ok' as RillValue,
        query: 'test',
        resultCount: 1,
      }));
      const wrappedFn = wrap('search', fn);

      const thrown = await captureThrown(() => wrappedFn({}, makeCtx()));
      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const signal = thrown as RuntimeHaltSignal;
      expect(signal.catchable).toBe(true);
      expect(isInvalid(signal.value)).toBe(true);
      const status = getStatus(signal.value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
      expect(status.message).toBe(`${provider}: extension disposed`);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('runtime dispatch after dispose', () => {
    function mountDisposed(): RuntimeContext {
      const disposalState = createDisposalState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        createInFlightState()
      );
      disposalState.isDisposed = true;
      return createRuntimeContext({
        functions: {
          search: {
            params: [],
            fn: wrap('search', async () => ({
              result: 'ok' as RillValue,
              query: 'test',
              resultCount: 1,
            })),
            annotations: { description: 'Test search' },
            returnType: anyTypeValue,
          },
        },
      });
    }

    it('rejects a script call with a catchable DISPOSED halt', async () => {
      const thrown = await execute(parse('search()'), mountDisposed()).catch(
        (e: unknown) => e
      );

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
    });

    it('completes a guarded script call with the DISPOSED invalid value', async () => {
      const result = await execute(
        parse('guard<on: list[#DISPOSED]> { search() }'),
        mountDisposed()
      );

      expect(getStatus(result.result).code.name).toBe('DISPOSED');
    });
  });

  describe('AbortController lifecycle', () => {
    it('registers controller during execution and removes it after', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      let capturedSize = 0;
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap('search', async () => {
        capturedSize = inFlightState.controllers.size;
        return { result: 'ok' as RillValue, query: 'q', resultCount: 1 };
      });
      await wrappedFn({}, makeCtx());
      expect(capturedSize).toBe(1);
      expect(inFlightState.controllers.size).toBe(0);
    });

    it('removes controller from inFlightState after error', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap('search', async () => {
        throw new Error('fetch failed');
      });
      const result = await wrappedFn({}, makeCtx());
      expect(isInvalid(result)).toBe(true);
      expect(inFlightState.controllers.size).toBe(0);
    });
  });

  describe('signal composition', () => {
    it('passes a signal that aborts when ctx.signal aborts', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const outer = new AbortController();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      let capturedSignal: AbortSignal | undefined;
      const wrappedFn = wrap('search', async (_args, _ctx, signal) => {
        capturedSignal = signal;
        return { result: 'ok' as RillValue, query: 'q', resultCount: 1 };
      });
      await wrappedFn({}, makeCtx({ signal: outer.signal }));
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);
      // After completion, abort outer and confirm signal would propagate to a new call:
      // a fresh wrapped call with a pre-aborted outer signal yields an aborted fn signal.
      outer.abort();
      let secondSignal: AbortSignal | undefined;
      const wrappedFn2 = wrap('search', async (_args, _ctx, signal) => {
        secondSignal = signal;
        return { result: 'ok' as RillValue, query: 'q', resultCount: 1 };
      });
      await wrappedFn2({}, makeCtx({ signal: outer.signal }));
      expect(secondSignal!.aborted).toBe(true);
    });

    it('uses the per-request controller signal when ctx.signal is undefined', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      let captured: AbortSignal | undefined;
      const wrappedFn = wrap('search', async (_args, _ctx, signal) => {
        captured = signal;
        return { result: 'ok' as RillValue, query: 'q', resultCount: 1 };
      });
      await wrappedFn({}, makeCtx());
      expect(captured).toBeDefined();
      expect(captured!.aborted).toBe(false);
    });
  });

  describe('event emission', () => {
    it('emits success event with duration, query, result_count', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const onLogEvent = vi.fn();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap('search', async () => ({
        result: ['r1', 'r2'] as RillValue,
        query: 'TypeScript',
        resultCount: 2,
      }));
      await wrappedFn({}, makeCtx({ onLogEvent }));
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:search`,
          subsystem: `extension:${provider}`,
          duration: expect.any(Number),
          query: 'TypeScript',
          result_count: 2,
        })
      );
    });

    it('emits error event with duration and error message on failure', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const onLogEvent = vi.fn();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap('search', async () => {
        throw new Error('fetch error');
      });
      const result = await wrappedFn({}, makeCtx({ onLogEvent }));
      expect(isInvalid(result)).toBe(true);
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:error`,
          subsystem: `extension:${provider}`,
          duration: expect.any(Number),
          error: expect.any(String),
        })
      );
    });
  });

  describe('error mapping', () => {
    it('throws a DISPOSED halt for an in-flight request aborted by dispose', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const events: unknown[] = [];
      const wrappedFn = wrap(
        'search',
        (_args, _ctx, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      );

      const pending = wrappedFn(
        {},
        makeCtx({ onLogEvent: (e) => events.push(e) })
      );
      disposalState.isDisposed = true;
      abortAll(inFlightState);
      const thrown = await captureThrown(() => pending);

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw).toMatchObject({ kind: 'extension_disposed' });
      expect(events).toHaveLength(1);
      expect(inFlightState.controllers.size).toBe(0);
    });

    it('keeps its own code for a non-abort error that settles after dispose', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap(
        'search',
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              reject(Object.assign(new Error('rate limited'), { status: 429 }));
            }, 0);
          })
      );

      const pending = wrappedFn({}, makeCtx());
      disposalState.isDisposed = true;
      abortAll(inFlightState);
      const result = await pending;

      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('RATE_LIMIT');
    });

    it('returns the abort mapping when aborted without dispose', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap(
        'search',
        (_args, _ctx, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          })
      );

      const pending = wrappedFn({}, makeCtx());
      abortAll(inFlightState);
      const result = await pending;

      expect(getStatus(result).code.name).toBe('TIMEOUT');
    });

    it('maps a ctx.signal abort to TIMEOUT when not disposed', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const wrappedFn = wrap(
        'search',
        (_args, _ctx, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      );
      const hostAbort = new AbortController();
      const pending = wrappedFn({}, makeCtx({ signal: hostAbort.signal }));
      hostAbort.abort();
      const result = await pending;

      expect(getStatus(result).code.name).toBe('TIMEOUT');
    });
  });

  describe('return value', () => {
    it('returns the result value from inner fn on success', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const expected = { items: ['a', 'b'], count: 2 };
      const wrappedFn = wrap('search', async () => ({
        result: expected as unknown as RillValue,
        query: 'test',
        resultCount: 2,
      }));
      const result = await wrappedFn({}, makeCtx());
      expect(result).toEqual(expected);
    });
  });

  describe('multiple operations share state', () => {
    it('all operations check the same disposal state', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );
      const search = wrap('search', async () => ({
        result: 'ok' as RillValue,
        query: 'q',
        resultCount: 1,
      }));
      const suggest = wrap('suggest', async () => ({
        result: 'ok' as RillValue,
        query: 'q',
        resultCount: 1,
      }));
      disposalState.isDisposed = true;
      const a = await captureThrown(() => search({}, makeCtx()));
      const b = await captureThrown(() => suggest({}, makeCtx()));
      expect(a).toBeInstanceOf(RuntimeHaltSignal);
      expect(b).toBeInstanceOf(RuntimeHaltSignal);
      const aValue = (a as RuntimeHaltSignal).value;
      const bValue = (b as RuntimeHaltSignal).value;
      expect(getStatus(aValue).message).toBe(`${provider}: extension disposed`);
      expect(getStatus(bValue).message).toBe(`${provider}: extension disposed`);
      expect(getStatus(aValue).raw['kind']).toBe('extension_disposed');
      expect(getStatus(bValue).raw['kind']).toBe('extension_disposed');
    });
  });
});
