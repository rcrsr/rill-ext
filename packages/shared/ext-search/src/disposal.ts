import { RuntimeError } from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @returns DisposalState object with isDisposed set to false
 */
export function createDisposalState(): DisposalState {
  return { isDisposed: false };
}

/**
 * Throw RuntimeError if extension instance has been disposed.
 * @param state - DisposalState object to check
 * @param provider - Extension provider name for error message
 * @throws RuntimeError (RILL-R004) when state.isDisposed === true
 */
export function checkDisposed(state: DisposalState, provider: string): void {
  if (state.isDisposed) {
    // EC-12: disposed extension throws RILL-R004
    throw new RuntimeError('RILL-R004', `${provider}: operation cancelled`);
  }
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
  // IR-6: Idempotent — return if already disposed
  if (state.isDisposed) {
    return;
  }

  // Invoke cleanup callback if provided; errors are logged, not thrown
  if (cleanup) {
    try {
      await cleanup();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Cleanup failed: ${message}`);
    }
  }

  // Set disposal flag after cleanup completes
  state.isDisposed = true;
}
