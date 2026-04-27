/**
 * Test suite for search function wrapper factory.
 *
 * Errors and disposal both surface as invalid RillValues; the wrapped
 * function never throws.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createSearchFunctionWrapper } from './wrapper.js';
import { createDisposalState } from './disposal.js';
import { createInFlightState } from './request.js';

// Pre-registered generic atoms for use in shared tests.


function makeCtx(opts?: { signal?: AbortSignal; onLogEvent?: (e: unknown) => void }): RuntimeContext {
  return createRuntimeContext({
    ...(opts?.signal ? { signal: opts.signal } : {}),
    callbacks: { onLogEvent: opts?.onLogEvent ?? (() => {}) },
  });
}

describe('createSearchFunctionWrapper', () => {
  const provider = 'testsearch';

  describe('disposal check', () => {
    it('returns invalid value when disposed before call', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      disposalState.isDisposed = true;

      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
      const fn = vi.fn(async () => ({
        result: 'ok' as RillValue,
        query: 'test',
        resultCount: 1,
      }));
      const wrappedFn = wrap('search', fn);

      const result = await wrappedFn({}, makeCtx());
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toBe(`${provider}: operation cancelled`);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('AbortController lifecycle', () => {
    it('registers controller during execution and removes it after', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      let capturedSize = 0;
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
    it('maps TypeError to connection_failed invalid value', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
      const wrappedFn = wrap('search', async () => {
        throw new TypeError('Failed to fetch');
      });
      const result = await wrappedFn({}, makeCtx());
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toBe(`${provider}: connection failed`);
    });

    it('maps AbortError name to TIMEOUT', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
      const wrappedFn = wrap('search', async () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      });
      const result = await wrappedFn({}, makeCtx());
      expect(getStatus(result).code.name).toBe('TIMEOUT');
      expect(getStatus(result).message).toBe(`${provider}: request timeout`);
    });
  });

  describe('return value', () => {
    it('returns the result value from inner fn on success', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const wrap = createSearchFunctionWrapper(provider, disposalState, inFlightState);
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
      const a = await search({}, makeCtx());
      const b = await suggest({}, makeCtx());
      expect(getStatus(a).message).toBe(`${provider}: operation cancelled`);
      expect(getStatus(b).message).toBe(`${provider}: operation cancelled`);
    });
  });
});
