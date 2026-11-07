/**
 * Test suite for disposal lifecycle utilities.
 * Disposed state surfaces as a catchable halt signal wrapping an invalid RillValue.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createDisposalState, checkDisposed, dispose } from './disposal.js';

// Use the pre-registered generic atom for disposal in tests.

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

describe('createDisposalState', () => {
  it('returns state with isDisposed = false', () => {
    expect(createDisposalState()).toEqual({ isDisposed: false });
  });

  it('creates independent state objects', () => {
    const a = createDisposalState();
    const b = createDisposalState();
    expect(a).not.toBe(b);
  });
});

describe('checkDisposed', () => {
  const provider = 'testsearch';
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = makeCtx();
  });

  it('returns null when not disposed', () => {
    const state = createDisposalState();
    expect(checkDisposed(ctx, state, provider)).toBeNull();
  });

  it('returns invalid DISPOSED value naming the provider when disposed', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(result).toBeInstanceOf(RuntimeHaltSignal);
    expect(result!.catchable).toBe(true);
    const status = getStatus(result!.value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.message).toBe(`${provider}: operation cancelled`);
    expect(status.raw['kind']).toBe('extension_disposed');
  });
});

describe('dispose', () => {
  it('completes without error when no cleanup provided', async () => {
    const state = createDisposalState();
    await expect(dispose(state)).resolves.toBeUndefined();
    expect(state.isDisposed).toBe(true);
  });

  it('calls cleanup once and sets disposed flag before it runs', async () => {
    const state = createDisposalState();
    let flagDuringCleanup: boolean | undefined;
    const cleanup = vi.fn(async () => {
      flagDuringCleanup = state.isDisposed;
    });
    await dispose(state, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(flagDuringCleanup).toBe(true);
    expect(state.isDisposed).toBe(true);
  });

  it('is idempotent — second dispose is a no-op', async () => {
    const state = createDisposalState();
    const cleanup = vi.fn(async () => {});
    await dispose(state, cleanup);
    await dispose(state, cleanup);
    await dispose(state, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('runs cleanup once when dispose is called concurrently', async () => {
    const state = createDisposalState();
    const cleanup = vi.fn(async () => {});
    await Promise.all([dispose(state, cleanup), dispose(state, cleanup)]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('logs warning and still disposes when cleanup throws', async () => {
    const state = createDisposalState();
    const cleanup = vi.fn(async () => {
      throw new Error('Cleanup failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await dispose(state, cleanup);
    expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Cleanup failed');
    expect(state.isDisposed).toBe(true);
    warnSpy.mockRestore();
  });

  it('handles non-Error cleanup throws', async () => {
    const state = createDisposalState();
    const cleanup = vi.fn(async () => {
      throw 'string error';
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await dispose(state, cleanup);
    expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Unknown error');
    warnSpy.mockRestore();
  });
});
