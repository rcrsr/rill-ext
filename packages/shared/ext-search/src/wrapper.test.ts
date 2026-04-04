/**
 * Test suite for search function wrapper factory.
 * Validates IR-3, AC-11, AC-22, AC-23, AC-24, AC-41, AC-42.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSearchFunctionWrapper } from './wrapper.js';
import { createDisposalState } from './disposal.js';
import { createInFlightState } from './request.js';
import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';

function createMockContext(): RuntimeContext {
  return {
    parent: undefined,
    variables: new Map(),
    variableTypes: new Map(),
    functions: new Map(),
    methods: new Map(),
    callbacks: {
      onOutput: vi.fn(),
      onLogEvent: vi.fn(),
    },
    observability: {},
    pipeValue: null,
    timeout: undefined,
    autoExceptions: [],
    signal: undefined,
    maxCallStackDepth: 100,
    annotationStack: [],
    callStack: [],
  };
}

describe('createSearchFunctionWrapper', () => {
  const provider = 'testsearch';

  describe('AC-23 / IR-3: Disposal check before execution', () => {
    it('throws operation cancelled when disposed before call', async () => {
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
      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow(RuntimeError);
      await expect(wrappedFn({}, ctx)).rejects.toThrow('operation cancelled');
    });

    it('does not execute fn when disposed', async () => {
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
      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('AC-42 / IR-3: AbortController registration and cleanup', () => {
    it('registers controller in inFlightState during execution', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      let capturedSize = 0;

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const fn = vi.fn(
        async (_args: Record<string, RillValue>, _ctx: RuntimeContext) => {
          capturedSize = inFlightState.controllers.size;
          return { result: 'ok' as RillValue, query: 'q', resultCount: 1 };
        }
      );

      const wrappedFn = wrap('search', fn);
      const ctx = createMockContext();

      await wrappedFn({}, ctx);

      expect(capturedSize).toBe(1);
    });

    it('removes controller from inFlightState after success (IR-3)', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const wrappedFn = wrap('search', async () => ({
        result: 'ok' as RillValue,
        query: 'q',
        resultCount: 1,
      }));

      const ctx = createMockContext();
      await wrappedFn({}, ctx);

      expect(inFlightState.controllers.size).toBe(0);
    });

    it('removes controller from inFlightState after error (IR-3)', async () => {
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

      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow();
      expect(inFlightState.controllers.size).toBe(0);
    });
  });

  describe('AC-11 / IR-3: Success event emission', () => {
    it('emits {provider}:{operation} event with duration, query, result_count', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('search', async () => ({
        result: ['result1', 'result2'] as RillValue,
        query: 'TypeScript tutorials',
        resultCount: 2,
      }));

      await wrappedFn({}, ctx);

      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:search`,
          subsystem: `extension:${provider}`,
          duration: expect.any(Number),
          query: 'TypeScript tutorials',
          result_count: 2,
        })
      );
    });

    it('emits event with non-negative duration', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('search', async () => ({
        result: null as RillValue,
        query: 'test query',
        resultCount: 0,
      }));

      await wrappedFn({}, ctx);

      const emitted = onLogEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(typeof emitted?.['duration']).toBe('number');
      expect((emitted?.['duration'] as number) >= 0).toBe(true);
    });
  });

  describe('AC-24 / IR-3: Error event emission on failure', () => {
    it('emits {provider}:error event with duration and error on failure', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('search', async () => {
        throw new Error('fetch error');
      });

      await expect(wrappedFn({}, ctx)).rejects.toThrow();

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

  describe('IR-3: Error mapping through mapSearchError', () => {
    it('maps TypeError to connection failed RuntimeError', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const wrappedFn = wrap('search', async () => {
        throw new TypeError('Failed to fetch');
      });

      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow(RuntimeError);
      await expect(wrappedFn({}, ctx)).rejects.toThrow('connection failed');
    });

    it('maps AbortError to request timeout RuntimeError', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const wrappedFn = wrap('search', async () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      });

      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow(RuntimeError);
      await expect(wrappedFn({}, ctx)).rejects.toThrow('request timeout');
    });

    it('passes through already-mapped RuntimeError', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const original = new RuntimeError('RILL-R004', 'already mapped');
      const wrappedFn = wrap('search', async () => {
        throw original;
      });

      const ctx = createMockContext();

      await expect(wrappedFn({}, ctx)).rejects.toThrow(original);
    });
  });

  describe('Return value', () => {
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
        result: expected as RillValue,
        query: 'test',
        resultCount: 2,
      }));

      const ctx = createMockContext();
      const result = await wrappedFn({}, ctx);

      expect(result).toEqual(expected);
    });
  });

  describe('AC-41 / IR-3: Timing measurement', () => {
    it('records timing across a small delay', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const onLogEvent = vi.fn();
      const ctx = createMockContext();
      ctx.callbacks.onLogEvent = onLogEvent;

      const wrappedFn = wrap('search', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { result: null as RillValue, query: 'q', resultCount: 0 };
      });

      await wrappedFn({}, ctx);

      const emitted = onLogEvent.mock.calls[0]?.[0] as Record<string, unknown>;
      const duration = emitted?.['duration'] as number;
      // Duration must be a non-negative number; exact value varies by environment
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Wrapper factory creates multiple independent operations', () => {
    it('wraps multiple operations sharing the same state', async () => {
      const disposalState = createDisposalState();
      const inFlightState = createInFlightState();

      const wrap = createSearchFunctionWrapper(
        provider,
        disposalState,
        inFlightState
      );

      const search = wrap('search', async () => ({
        result: 'search-result' as RillValue,
        query: 'q1',
        resultCount: 1,
      }));

      const suggest = wrap('suggest', async () => ({
        result: 'suggest-result' as RillValue,
        query: 'q2',
        resultCount: 3,
      }));

      const ctx = createMockContext();

      expect(await search({}, ctx)).toBe('search-result');
      expect(await suggest({}, ctx)).toBe('suggest-result');
    });

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

      const ctx = createMockContext();
      disposalState.isDisposed = true;

      await expect(search({}, ctx)).rejects.toThrow('operation cancelled');
      await expect(suggest({}, ctx)).rejects.toThrow('operation cancelled');
    });
  });
});
