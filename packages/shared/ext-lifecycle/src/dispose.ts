/**
 * Dispose-cancellation helpers shared by non-LLM extensions.
 *
 * `dispose()` aborts in-flight vendor work. The aborted call then fails with
 * an abort-shaped error, which must report `#DISPOSED` instead of a generic
 * provider failure. Errors that are not abort-shaped (429, auth, timeout, ...)
 * keep their own code even when they settle after dispose.
 */

import {
  RuntimeError,
  RuntimeHaltSignal,
  getStatus,
  isInvalid,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

const MAX_CAUSE_DEPTH = 8;

function causeOf(error: unknown): unknown {
  if (error instanceof RuntimeError) {
    const ctxCause = error.context?.['cause'];
    if (ctxCause !== undefined) return ctxCause;
  }
  return error instanceof Error ? error.cause : undefined;
}

/**
 * True for errors an aborted request produces: `AbortError` (fetch, Node
 * streams, `DOMException`), or any error whose `cause` chain contains one.
 *
 * `TimeoutError` (from `AbortSignal.timeout`) is deliberately NOT abort-shaped:
 * a request that timed out on its own is a timeout, not a cancellation by
 * dispose(), even when it settles after dispose. dispose() aborts through an
 * `AbortController`, which always produces `AbortError`.
 */
export function isAbortShaped(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (
      typeof current === 'object' &&
      current !== null &&
      (current as { name?: unknown }).name === 'AbortError'
    ) {
      return true;
    }
    current = causeOf(current);
    if (current === undefined) return false;
  }
  return false;
}

/**
 * Resolve the error to classify for a request that may have been aborted by
 * dispose(). Request helpers that map an `AbortError` themselves throw an
 * already-mapped invalid value with `raw.kind: 'request_timeout'`; when the
 * per-request controller's signal is aborted, that value stands for the abort,
 * so the signal's reason (an `AbortError`) is returned. Any other error is
 * returned unchanged.
 */
export function abortCauseOf(error: unknown, signal: AbortSignal): unknown {
  if (
    signal.aborted &&
    isInvalid(error as RillValue) &&
    getStatus(error as RillValue).raw['kind'] === 'request_timeout'
  ) {
    return signal.reason;
  }
  return error;
}

/**
 * Build the `#DISPOSED` halt (`raw.kind: 'extension_disposed'`) for a provider.
 */
export function createDisposedHalt(
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
 * Returns the `#DISPOSED` halt when the extension is disposed and the error is
 * abort-shaped, otherwise undefined.
 */
export function disposedHaltFor(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
  disposed: boolean
): RuntimeHaltSignal | undefined {
  if (!disposed || !isAbortShaped(error)) return undefined;
  return createDisposedHalt(ctx, provider);
}

/**
 * Throws the `#DISPOSED` halt when the extension is disposed and the error is
 * abort-shaped. Otherwise returns, leaving the caller to classify the error.
 * `onDisposed` runs first so callers can emit their `<provider>:error` event.
 */
export function throwIfCancelledByDispose(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
  disposed: boolean,
  onDisposed?: () => void
): void {
  const halt = disposedHaltFor(ctx, provider, error, disposed);
  if (halt === undefined) return;
  onDisposed?.();
  throw halt;
}
