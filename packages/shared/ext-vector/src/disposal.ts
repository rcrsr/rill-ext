import { getStatus, RuntimeHaltSignal, type RuntimeContext } from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @param _provider - Extension provider name (reserved for future error context)
 */
export function createDisposalState(_provider: string): DisposalState {
  return { isDisposed: false };
}

const MAX_CAUSE_DEPTH = 8;

/**
 * True for errors an aborted request produces: an `AbortError`, or any error
 * whose `cause` chain contains one. `TimeoutError` is deliberately not
 * abort-shaped: a request that timed out on its own is a timeout, not a
 * cancellation by dispose(). Local copy because shared packages must not
 * import other shared packages.
 */
function isAbortShaped(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (
      typeof current === 'object' &&
      current !== null &&
      (current as { name?: unknown }).name === 'AbortError'
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
    if (current === undefined) return false;
  }
  return false;
}

function createDisposedHalt(
  ctx: RuntimeContext,
  provider: string
): RuntimeHaltSignal {
  const message = `${provider}: extension disposed`;
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code: 'DISPOSED',
      provider,
      raw: { kind: 'extension_disposed', message },
    }),
    true
  );
}

/**
 * Return a catchable halt signal wrapping the `#DISPOSED` invalid (raw kind
 * `extension_disposed`) when the extension instance is disposed, otherwise
 * null. The caller throws a non-null result; a bare thrown invalid would
 * become `#R999` at the dispatch boundary.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param state - DisposalState to check
 * @param provider - Extension provider name for diagnostic message
 */
export function checkDisposed(
  ctx: RuntimeContext,
  state: DisposalState,
  provider: string
): RuntimeHaltSignal | null {
  if (!state.isDisposed) return null;
  return createDisposedHalt(ctx, provider);
}

/**
 * Return the `#DISPOSED` halt when the extension is disposed and the error is
 * abort-shaped (the failure dispose() caused), otherwise null. Errors that are
 * not abort-shaped keep their own code even when they settle after dispose. A
 * `#DISPOSED` halt thrown inside the wrapped operation (a disposal re-check
 * between steps) is returned unchanged so it is never remapped.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param state - DisposalState to check
 * @param provider - Extension provider name
 * @param error - Error raised by the vendor call
 */
export function disposedHaltFor(
  ctx: RuntimeContext,
  state: DisposalState,
  provider: string,
  error: unknown
): RuntimeHaltSignal | null {
  if (
    error instanceof RuntimeHaltSignal &&
    getStatus(error.value).code.name === 'DISPOSED'
  ) {
    return error;
  }
  if (!state.isDisposed || !isAbortShaped(error)) return null;
  return createDisposedHalt(ctx, provider);
}

export async function dispose(
  state: DisposalState,
  cleanup?: () => Promise<void>
): Promise<void> {
  if (state.isDisposed) return;
  state.isDisposed = true;
  if (cleanup) {
    try {
      await cleanup();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Cleanup failed: ${message}`);
    }
  }
}
