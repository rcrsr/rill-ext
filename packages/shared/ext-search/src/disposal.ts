import { type RillValue, type RuntimeContext } from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @returns DisposalState object with isDisposed set to false
 */
export function createDisposalState(): DisposalState {
  return { isDisposed: false };
}

/**
 * Return an invalid RillValue when the extension instance is disposed,
 * otherwise null.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param state - DisposalState to check
 * @param provider - Extension provider name for diagnostic message
 * @param disposedCode - Atom name registered by the consuming extension for disposal
 */
export function checkDisposed(
  ctx: RuntimeContext,
  state: DisposalState,
  provider: string,
  disposedCode: string
): RillValue | null {
  if (!state.isDisposed) {
    return null;
  }
  const error = new Error(`${provider}: operation cancelled`);
  return ctx.invalidate(error, {
    code: disposedCode,
    provider,
    raw: { kind: 'disposed', message: `${provider}: operation cancelled` },
  });
}

/**
 * Set disposal flag and invoke optional cleanup callback.
 * Idempotent: returns immediately if already disposed.
 * Cleanup errors are logged but do not propagate.
 *
 * @param state - DisposalState object to update
 * @param cleanup - Optional async cleanup callback
 */
export async function dispose(
  state: DisposalState,
  cleanup?: () => Promise<void>
): Promise<void> {
  if (state.isDisposed) {
    return;
  }

  if (cleanup) {
    try {
      await cleanup();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Cleanup failed: ${message}`);
    }
  }

  state.isDisposed = true;
}
