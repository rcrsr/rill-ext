/**
 * Unit tests for the dispose-cancellation helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  RuntimeError,
  RuntimeHaltSignal,
  createRuntimeContext,
  getStatus,
} from '@rcrsr/rill';
import {
  isAbortShaped,
  abortCauseOf,
  createDisposedHalt,
  disposedHaltFor,
  throwIfCancelledByDispose,
} from '../src/index.js';

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

describe('isAbortShaped', () => {
  it('returns true for an AbortError', () => {
    expect(isAbortShaped(abortError())).toBe(true);
  });

  it('returns true for an abort DOMException', () => {
    expect(isAbortShaped(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('returns true for the reason of an aborted controller', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortShaped(controller.signal.reason)).toBe(true);
  });

  it('returns true for an error whose cause is an abort', () => {
    const err = new Error('fetch failed', { cause: abortError() });
    expect(isAbortShaped(err)).toBe(true);
  });

  it('returns true for a RuntimeError caused by an abort', () => {
    const err = new RuntimeError('RILL-R001', 'wrapped', undefined, {
      cause: abortError(),
    });
    expect(isAbortShaped(err)).toBe(true);
  });

  it('returns false for a TimeoutError', () => {
    expect(isAbortShaped(new DOMException('timed out', 'TimeoutError'))).toBe(
      false
    );
  });

  it('returns false for an ordinary error', () => {
    expect(isAbortShaped(new Error('HTTP 429'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isAbortShaped({})).toBe(false);
    expect(isAbortShaped('AbortError')).toBe(false);
    expect(isAbortShaped(null)).toBe(false);
  });

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.defineProperty(a, 'cause', { value: b });
    expect(isAbortShaped(a)).toBe(false);
  });
});

describe('abortCauseOf', () => {
  function timeoutInvalid(kind: string): unknown {
    const ctx = createRuntimeContext();
    return ctx.invalidate(abortError(), {
      code: 'TIMEOUT',
      provider: 'acme',
      raw: { kind },
    });
  }

  it('returns the signal reason for a request_timeout invalid under an aborted signal', () => {
    const controller = new AbortController();
    controller.abort();

    const cause = abortCauseOf(
      timeoutInvalid('request_timeout'),
      controller.signal
    );

    expect(cause).toBe(controller.signal.reason);
    expect(isAbortShaped(cause)).toBe(true);
  });

  it('returns the error when the signal is not aborted', () => {
    const error = timeoutInvalid('request_timeout');
    expect(abortCauseOf(error, new AbortController().signal)).toBe(error);
  });

  it('returns the error for an invalid of another kind', () => {
    const controller = new AbortController();
    controller.abort();
    const error = timeoutInvalid('network_error');
    expect(abortCauseOf(error, controller.signal)).toBe(error);
  });

  it('returns a plain error unchanged', () => {
    const controller = new AbortController();
    controller.abort();
    const error = new Error('x');
    expect(abortCauseOf(error, controller.signal)).toBe(error);
  });
});

describe('createDisposedHalt', () => {
  it('builds a halt carrying #DISPOSED with extension_disposed', () => {
    const ctx = createRuntimeContext();
    const halt = createDisposedHalt(ctx, 'acme');
    const status = getStatus(halt.value);

    expect(halt).toBeInstanceOf(RuntimeHaltSignal);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.provider).toBe('acme');
    expect(status.raw?.['kind']).toBe('extension_disposed');
  });
});

describe('disposedHaltFor', () => {
  it('returns a halt when disposed and abort-shaped', () => {
    const ctx = createRuntimeContext();
    expect(disposedHaltFor(ctx, 'acme', abortError(), true)).toBeInstanceOf(
      RuntimeHaltSignal
    );
  });

  it('returns undefined when not disposed', () => {
    const ctx = createRuntimeContext();
    expect(disposedHaltFor(ctx, 'acme', abortError(), false)).toBeUndefined();
  });

  it('returns undefined for a stale non-abort error after dispose', () => {
    const ctx = createRuntimeContext();
    expect(
      disposedHaltFor(ctx, 'acme', new Error('HTTP 500'), true)
    ).toBeUndefined();
  });
});

describe('throwIfCancelledByDispose', () => {
  it('throws the halt and runs onDisposed first', () => {
    const ctx = createRuntimeContext();
    const onDisposed = vi.fn<() => void>();

    expect(() =>
      throwIfCancelledByDispose(ctx, 'acme', abortError(), true, onDisposed)
    ).toThrow(RuntimeHaltSignal);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it('returns without calling onDisposed for a stale non-abort error', () => {
    const ctx = createRuntimeContext();
    const onDisposed = vi.fn<() => void>();

    throwIfCancelledByDispose(ctx, 'acme', new Error('x'), true, onDisposed);

    expect(onDisposed).not.toHaveBeenCalled();
  });

  it('returns when the extension is not disposed', () => {
    const ctx = createRuntimeContext();
    expect(() =>
      throwIfCancelledByDispose(ctx, 'acme', abortError(), false)
    ).not.toThrow();
  });
});
