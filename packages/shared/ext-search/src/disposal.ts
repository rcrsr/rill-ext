import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @returns DisposalState object with isDisposed set to false
 */
export function createDisposalState(): DisposalState {
  return { isDisposed: false };
}

/**
 * Build the invalid RillValue for a disposed extension: generic `#DISPOSED`
 * atom with `raw.kind: 'extension_disposed'`. Unconditional; exported for the wrapper, not re-exported from the barrel.
 */
export function buildDisposedInvalid(
  ctx: RuntimeContext,
  provider: string
): RillValue {
  const error = new Error(`${provider}: operation cancelled`);
  return ctx.invalidate(error, {
    code: 'DISPOSED',
    provider,
    raw: {
      kind: 'extension_disposed',
      message: `${provider}: operation cancelled`,
    },
  });
}

/**
 * Return a catchable halt signal wrapping the `#DISPOSED` invalid
 * (`raw.kind: 'extension_disposed'`) when the extension instance is
 * disposed, otherwise null. The caller throws the non-null result; a bare
 * thrown invalid would become `#R999` at the dispatch boundary.
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
  if (!state.isDisposed) {
    return null;
  }
  return new RuntimeHaltSignal(buildDisposedInvalid(ctx, provider), true);
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
