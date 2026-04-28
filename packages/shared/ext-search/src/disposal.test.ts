/**
 * Test suite for disposal lifecycle utilities.
 * Disposed state surfaces as an invalid RillValue via ctx.invalidate.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
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

  it('returns invalid RillValue when disposed', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(result).not.toBeNull();
    const status = getStatus(result!);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.message).toBe(`${provider}: operation cancelled`);
  });

  it('includes provider name in disposed message', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, 'my-search-ext');
    expect(getStatus(result!).message).toBe('my-search-ext: operation cancelled');
  });
});

describe('dispose', () => {
  it('completes without error when no cleanup provided', async () => {
    const state = createDisposalState();
    await expect(dispose(state)).resolves.toBeUndefined();
    expect(state.isDisposed).toBe(true);
  });

  it('calls cleanup once and sets disposed flag after', async () => {
    const state = createDisposalState();
    let flagDuringCleanup: boolean | undefined;
    const cleanup = vi.fn(async () => {
      flagDuringCleanup = state.isDisposed;
    });
    await dispose(state, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(flagDuringCleanup).toBe(false);
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

  it('checkDisposed returns invalid value after dispose', async () => {
    const ctx = makeCtx();
    const provider = 'testsearch';
    const state = createDisposalState();
    await dispose(state);
    const result = checkDisposed(ctx, state, provider);
    expect(result).not.toBeNull();
    expect(getStatus(result!).message).toBe(`${provider}: operation cancelled`);
  });
});
