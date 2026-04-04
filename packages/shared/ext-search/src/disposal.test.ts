/**
 * Test suite for disposal lifecycle utilities.
 * Validates IR-6 disposal lifecycle and AC-22, AC-23, AC-34, AC-35 acceptance criteria.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDisposalState, checkDisposed, dispose } from './disposal.js';
import { RuntimeError } from '@rcrsr/rill';

describe('createDisposalState', () => {
  it('returns state with isDisposed set to false (IR-6)', () => {
    const state = createDisposalState();

    expect(state).toEqual({ isDisposed: false });
  });

  it('creates independent state objects', () => {
    const state1 = createDisposalState();
    const state2 = createDisposalState();

    expect(state1).not.toBe(state2);
    expect(state1.isDisposed).toBe(false);
    expect(state2.isDisposed).toBe(false);
  });
});

describe('checkDisposed', () => {
  const provider = 'testsearch';

  describe('EC-12: Disposed state throws RuntimeError (IR-6)', () => {
    it('throws RuntimeError with RILL-R004 when disposed', () => {
      const state = { isDisposed: true };

      expect(() => checkDisposed(state, provider)).toThrow(RuntimeError);
    });

    it('throws with correct error code RILL-R004', () => {
      const state = { isDisposed: true };

      try {
        checkDisposed(state, provider);
        expect.fail('Expected RuntimeError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
      }
    });

    it('throws with operation cancelled message (EC-12)', () => {
      const state = { isDisposed: true };

      expect(() => checkDisposed(state, provider)).toThrow(
        `${provider}: operation cancelled`
      );
    });

    it('includes provider name in error message', () => {
      const customProvider = 'my-search-ext';
      const state = { isDisposed: true };

      expect(() => checkDisposed(state, customProvider)).toThrow(
        `${customProvider}: operation cancelled`
      );
    });
  });

  describe('IR-6: Not disposed — does not throw', () => {
    it('does not throw when not disposed', () => {
      const state = { isDisposed: false };

      expect(() => checkDisposed(state, provider)).not.toThrow();
    });

    it('returns void without throwing (IR-6)', () => {
      const state = { isDisposed: false };

      const result = checkDisposed(state, provider);
      expect(result).toBeUndefined();
    });
  });
});

describe('dispose', () => {
  describe('AC-34: dispose() with no in-flight requests completes without error', () => {
    it('completes without error when no cleanup provided', async () => {
      const state = createDisposalState();

      await expect(dispose(state)).resolves.toBeUndefined();
      expect(state.isDisposed).toBe(true);
    });
  });

  describe('IR-6: dispose calls cleanup before setting flag', () => {
    it('calls cleanup callback once', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {});

      await dispose(state, cleanup);

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('sets isDisposed to true after cleanup', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {});

      expect(state.isDisposed).toBe(false);
      await dispose(state, cleanup);
      expect(state.isDisposed).toBe(true);
    });

    it('verifies cleanup runs before flag is set', async () => {
      const state = createDisposalState();
      let flagDuringCleanup: boolean | undefined;

      const cleanup = vi.fn(async () => {
        flagDuringCleanup = state.isDisposed;
      });

      await dispose(state, cleanup);

      // isDisposed must be false during cleanup (flag set after)
      expect(flagDuringCleanup).toBe(false);
      expect(state.isDisposed).toBe(true);
    });
  });

  describe('AC-35: dispose() called twice is idempotent (IR-6)', () => {
    it('does not call cleanup on second dispose call', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {});

      await dispose(state, cleanup);
      await dispose(state, cleanup);

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('remains disposed after second call', async () => {
      const state = createDisposalState();

      await dispose(state);
      await dispose(state);

      expect(state.isDisposed).toBe(true);
    });

    it('handles three dispose calls — first sets flag, rest are no-ops', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {});

      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);

      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);

      await dispose(state, cleanup);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('IR-6: Cleanup errors are logged and do not propagate', () => {
    it('logs warning when cleanup throws', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {
        throw new Error('Cleanup failed');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await dispose(state, cleanup);

      expect(warnSpy).toHaveBeenCalledWith('Cleanup failed: Cleanup failed');
      warnSpy.mockRestore();
    });

    it('still sets isDisposed when cleanup fails', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {
        throw new Error('Cleanup error');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await dispose(state, cleanup);
      expect(state.isDisposed).toBe(true);

      warnSpy.mockRestore();
    });

    it('does not throw when cleanup fails', async () => {
      const state = createDisposalState();
      const cleanup = vi.fn(async () => {
        throw new Error('Cleanup error');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(dispose(state, cleanup)).resolves.toBeUndefined();

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

  describe('Integration: checkDisposed after dispose', () => {
    it('throws operation cancelled after dispose (EC-12)', async () => {
      const provider = 'testsearch';
      const state = createDisposalState();

      await dispose(state);

      expect(() => checkDisposed(state, provider)).toThrow(RuntimeError);
      expect(() => checkDisposed(state, provider)).toThrow(
        `${provider}: operation cancelled`
      );
    });
  });
});
