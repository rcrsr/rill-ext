/**
 * Test suite for vector function wrapper factory.
 * Disposal and errors surface as invalid RillValues; the wrapper never throws.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createFunctionWrapper } from '../src/wrapper.js';
import { createDisposalState } from '../src/disposal.js';

function makeCtx(opts?: { onLogEvent?: (e: unknown) => void }): RuntimeContext {
  return createRuntimeContext({
    callbacks: { onLogEvent: opts?.onLogEvent ?? (() => {}) },
  });
}

describe('createFunctionWrapper', () => {
  const provider = 'testdb';

  describe('disposal', () => {
    it('returns invalid RillValue when state is disposed', async () => {
      const state = createDisposalState(provider);
      state.isDisposed = true;
      const wrap = createFunctionWrapper(provider, state);
      const wrappedFn = wrap('query', async () => 'result' as RillValue);
      const result = await wrappedFn({}, makeCtx());
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toBe(
        `${provider}: operation cancelled`
      );
    });

    it('does not invoke fn when disposed', async () => {
      const state = createDisposalState(provider);
      state.isDisposed = true;
      const fn = vi.fn(async () => 'result' as RillValue);
      const wrap = createFunctionWrapper(provider, state);
      await wrap('query', fn)({}, makeCtx());
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it('returns invalid RillValue when fn throws', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const wrappedFn = wrap('query', async () => {
        throw new Error('401 unauthorized');
      });
      const result = await wrappedFn({}, makeCtx());
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).message).toContain('authentication failed');
    });

    it('emits error event on failure with duration and error message', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const onLogEvent = vi.fn();
      const wrappedFn = wrap('upsert', async () => {
        throw new Error('dimension mismatch');
      });
      await wrappedFn({}, makeCtx({ onLogEvent }));
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:error`,
          subsystem: `extension:${provider}`,
          error: expect.stringContaining('dimension mismatch'),
          duration: expect.any(Number),
        })
      );
    });
  });

  describe('success event emission', () => {
    it('emits success event with duration and metadata', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const onLogEvent = vi.fn();
      const wrappedFn = wrap(
        'upsert',
        async () => 'ok' as RillValue,
        (args) => ({
          collection: args['collection'],
          count: args['count'],
        })
      );
      await wrappedFn(
        { collection: 'my-collection' as RillValue, count: 5 as RillValue },
        makeCtx({ onLogEvent })
      );
      expect(onLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: `${provider}:upsert`,
          subsystem: `extension:${provider}`,
          duration: expect.any(Number),
          collection: 'my-collection',
          count: 5,
        })
      );
    });
  });

  describe('return value', () => {
    it('returns wrapped function result on success', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const wrappedFn = wrap('query', async () => 'success' as RillValue);
      expect(await wrappedFn({}, makeCtx())).toBe('success');
    });

    it('preserves complex return values', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const expected = { items: [1, 2, 3], count: 3 };
      const wrappedFn = wrap(
        'query',
        async () => expected as unknown as RillValue
      );
      expect(await wrappedFn({}, makeCtx())).toEqual(expected);
    });
  });

  describe('multiple operations share state', () => {
    it('all wrapped functions check same disposal state', async () => {
      const state = createDisposalState(provider);
      const wrap = createFunctionWrapper(provider, state);
      const query = wrap('query', async () => 'q' as RillValue);
      const upsert = wrap('upsert', async () => 'u' as RillValue);
      state.isDisposed = true;
      const a = await query({}, makeCtx());
      const b = await upsert({}, makeCtx());
      expect(getStatus(a).message).toBe(`${provider}: operation cancelled`);
      expect(getStatus(b).message).toBe(`${provider}: operation cancelled`);
    });
  });
});
