/**
 * Dispose-cancellation helpers shared by LLM provider extensions.
 *
 * `dispose()` aborts in-flight vendor work. The aborted call then fails with
 * an abort-shaped error, which must report `#DISPOSED` instead of a generic
 * provider failure. Errors that are not abort-shaped (429, auth, ...) keep
 * their own code even when they settle after dispose.
 */

import {
  RuntimeError,
  RuntimeHaltSignal,
  getStatus,
  type RuntimeContext,
} from '@rcrsr/rill';

/**
 * True for errors an aborted request produces: fetch `AbortError`, the
 * OpenAI SDK's `APIUserAbortError`, the shared tool loop's cancellation or
 * timeout halt, or a `RuntimeError` wrapping any of those as `context.cause`.
 * API, auth and rate-limit failures are not abort-shaped.
 */
export function isAbortShaped(error: unknown): boolean {
  // The shared tool loop wraps an aborted request, or its own signal abort,
  // as a #TIMEOUT halt.
  if (error instanceof RuntimeHaltSignal) {
    const kind = getStatus(error.value).raw?.['kind'];
    return kind === 'tool_loop_cancelled' || kind === 'request_timeout';
  }
  // The shared tool loop wraps provider errors without a detector in a
  // RuntimeError carrying the original error as context.cause.
  if (error instanceof RuntimeError) {
    return isAbortShaped(error.context?.['cause']);
  }
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.constructor.name === 'APIUserAbortError')
  );
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
