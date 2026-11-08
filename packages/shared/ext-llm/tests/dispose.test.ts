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
  createDisposedHalt,
  disposedHaltFor,
  throwIfCancelledByDispose,
} from '../src/index.js';

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function haltWithKind(kind: string): RuntimeHaltSignal {
  const ctx = createRuntimeContext();
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error('x'), {
      code: 'TIMEOUT',
      provider: 'test',
      raw: { kind },
    }),
    true
  );
}

describe('isAbortShaped', () => {
  it('returns true for an AbortError', () => {
    expect(isAbortShaped(abortError())).toBe(true);
  });

  it('returns true for an APIUserAbortError by constructor name', () => {
    class APIUserAbortError extends Error {}
    expect(isAbortShaped(new APIUserAbortError('aborted'))).toBe(true);
  });

  it('returns true for tool loop cancellation and timeout halts', () => {
    expect(isAbortShaped(haltWithKind('tool_loop_cancelled'))).toBe(true);
  });

  it('returns true for a request_timeout halt derived from an abort', () => {
    const halt = new RuntimeHaltSignal(
      createRuntimeContext().invalidate(new Error('aborted'), {
        code: 'TIMEOUT',
        provider: 'test',
        raw: { kind: 'request_timeout', aborted: true },
      }),
      true
    );
    expect(isAbortShaped(halt)).toBe(true);
  });

  it('returns false for a genuine request_timeout halt such as HTTP 408', () => {
    const halt = new RuntimeHaltSignal(
      createRuntimeContext().invalidate(new Error('408'), {
        code: 'TIMEOUT',
        provider: 'test',
        raw: { kind: 'request_timeout', status: 408 },
      }),
      true
    );
    expect(isAbortShaped(halt)).toBe(false);
    expect(isAbortShaped(haltWithKind('request_timeout'))).toBe(false);
  });

  it('returns true for a RuntimeError caused by an abort', () => {
    const err = new RuntimeError('RILL-R001', 'wrapped', undefined, {
      cause: abortError(),
    });
    expect(isAbortShaped(err)).toBe(true);
  });

  it('returns false for a halt with another kind', () => {
    expect(isAbortShaped(haltWithKind('rate_limited'))).toBe(false);
  });

  it('returns false for ordinary and non-error values', () => {
    expect(isAbortShaped(new Error('429'))).toBe(false);
    expect(isAbortShaped('AbortError')).toBe(false);
    expect(isAbortShaped(null)).toBe(false);
  });
});

describe('createDisposedHalt', () => {
  it('builds a #DISPOSED halt with extension_disposed kind', () => {
    const halt = createDisposedHalt(createRuntimeContext(), 'acme');
    const status = getStatus(halt.value);
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

  it('returns undefined when disposed but not abort-shaped', () => {
    const ctx = createRuntimeContext();
    expect(
      disposedHaltFor(ctx, 'acme', new Error('429'), true)
    ).toBeUndefined();
  });
});

describe('throwIfCancelledByDispose', () => {
  it('throws the disposed halt and runs the callback first', () => {
    const ctx = createRuntimeContext();
    const onDisposed = vi.fn<() => void>();
    let thrown: unknown;
    try {
      throwIfCancelledByDispose(ctx, 'acme', abortError(), true, onDisposed);
    } catch (e: unknown) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it('returns without throwing for a non-abort error after dispose', () => {
    const ctx = createRuntimeContext();
    const onDisposed = vi.fn<() => void>();
    expect(() =>
      throwIfCancelledByDispose(ctx, 'acme', new Error('429'), true, onDisposed)
    ).not.toThrow();
    expect(onDisposed).not.toHaveBeenCalled();
  });

  it('returns without throwing when not disposed', () => {
    const ctx = createRuntimeContext();
    expect(() =>
      throwIfCancelledByDispose(ctx, 'acme', abortError(), false)
    ).not.toThrow();
  });
});
