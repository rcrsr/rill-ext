/**
 * Test suite for vector disposal lifecycle utilities.
 * Disposed state surfaces as an invalid RillValue via ctx.invalidate.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createDisposalState, checkDisposed, dispose } from '../src/disposal.js';

describe('createDisposalState', () => {
  it('returns initial state with isDisposed false', () => {
    expect(createDisposalState('test-provider')).toEqual({ isDisposed: false });
  });

  it('creates independent state objects', () => {
    const a = createDisposalState('p1');
    const b = createDisposalState('p2');
    expect(a).not.toBe(b);
  });
});

describe('checkDisposed', () => {
  const provider = 'test-db';
  let ctx: RuntimeContext;
  beforeAll(() => {
    ctx = createRuntimeContext();
  });

  it('returns null when not disposed', () => {
    const state = { isDisposed: false };
    expect(checkDisposed(ctx, state, provider)).toBeNull();
  });

  it('returns invalid RillValue with disposed message when disposed', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(result).not.toBeNull();
    expect(getStatus(result!).message).toBe(`${provider}: operation cancelled`);
  });

  it('includes provider name in disposed message', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, 'my-custom-provider');
    expect(getStatus(result!).message).toBe('my-custom-provider: operation cancelled');
  });

  it('emits #DISPOSED atom code', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(getStatus(result!).code.name).toBe('DISPOSED');
  });
});

describe('dispose', () => {
  it('calls cleanup once and sets disposed flag', async () => {
    const state = createDisposalState('test-provider');
    const cleanup = vi.fn(async () => {});
    await dispose(state, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(state.isDisposed).toBe(true);
  });

  it('works without cleanup callback', async () => {
    const state = createDisposalState('test-provider');
    await dispose(state);
    expect(state.isDisposed).toBe(true);
  });

  it('is idempotent — three dispose calls invoke cleanup once', async () => {
    const state = createDisposalState('test-provider');
    const cleanup = vi.fn(async () => {});
    await dispose(state, cleanup);
    await dispose(state, cleanup);
    await dispose(state, cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(state.isDisposed).toBe(true);
  });

  it('logs warning and still disposes when cleanup throws', async () => {
    const state = createDisposalState('test-provider');
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
    const state = createDisposalState('test-provider');
    const cleanup = vi.fn(async () => {
      throw 'string error';
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await dispose(state, cleanup);
    expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Unknown error');
    warnSpy.mockRestore();
  });

  it('checkDisposed returns invalid value after dispose', async () => {
    const ctx = createRuntimeContext();
    const provider = 'test-provider';
    const state = createDisposalState(provider);
    await dispose(state);
    const result = checkDisposed(ctx, state, provider);
    expect(result).not.toBeNull();
    expect(getStatus(result!).message).toBe(`${provider}: operation cancelled`);
  });
});
