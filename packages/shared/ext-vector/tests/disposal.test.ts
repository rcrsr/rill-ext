/**
 * Test suite for vector disposal lifecycle utilities.
 * Disposed state surfaces as a catchable halt signal wrapping an invalid RillValue.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  getStatus,
  parse,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  createDisposalState,
  checkDisposed,
  dispose,
} from '../src/disposal.js';

describe('createDisposalState', () => {
  it('returns initial state with isDisposed false', () => {
    expect(createDisposalState('test-provider')).toEqual({ isDisposed: false });
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

  it('returns catchable halt signal with disposed message when disposed', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(result).toBeInstanceOf(RuntimeHaltSignal);
    expect(result!.catchable).toBe(true);
    expect(getStatus(result!.value).message).toBe(
      `${provider}: operation cancelled`
    );
  });

  it('emits #DISPOSED atom code', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(getStatus(result!.value).code.name).toBe('DISPOSED');
  });

  it('emits extension_disposed raw kind', () => {
    const state = { isDisposed: true };
    const result = checkDisposed(ctx, state, provider);
    expect(getStatus(result!.value).raw['kind']).toBe('extension_disposed');
  });
});

describe('runtime dispatch after dispose', () => {
  function mountDisposed(): RuntimeContext {
    const state = { isDisposed: true };
    return createRuntimeContext({
      functions: {
        query: {
          params: [],
          fn: (_args, ctx) => {
            const halt = checkDisposed(ctx, state, 'test-db');
            if (halt) throw halt;
            return 'ok';
          },
          annotations: { description: 'Test query' },
          returnType: anyTypeValue,
        },
      },
    });
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const thrown = await execute(parse('query()'), mountDisposed()).catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { query() }'),
      mountDisposed()
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
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

  it('sets disposed flag before cleanup runs', async () => {
    const state = createDisposalState('test-provider');
    let flagDuringCleanup: boolean | undefined;
    await dispose(state, async () => {
      flagDuringCleanup = state.isDisposed;
    });
    expect(flagDuringCleanup).toBe(true);
  });

  it('runs cleanup once when dispose is called concurrently', async () => {
    const state = createDisposalState('test-provider');
    const cleanup = vi.fn(async () => {});
    await Promise.all([dispose(state, cleanup), dispose(state, cleanup)]);
    expect(cleanup).toHaveBeenCalledTimes(1);
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
});
