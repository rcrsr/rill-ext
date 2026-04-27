import { type RillValue, type RuntimeContext } from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @param _provider - Extension provider name (reserved for future error context)
 */
export function createDisposalState(_provider: string): DisposalState {
  return { isDisposed: false };
}

/**
 * Return an invalid RillValue (atom `#DISPOSED`) when the extension
 * instance is disposed, otherwise null.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param state - DisposalState to check
 * @param provider - Extension provider name for diagnostic message
 */
export function checkDisposed(
  ctx: RuntimeContext,
  state: DisposalState,
  provider: string
): RillValue | null {
  if (!state.isDisposed) return null;
  const error = new Error(`${provider}: operation cancelled`);
  return ctx.invalidate(error, {
    code: 'DISPOSED',
    provider,
    raw: { kind: 'disposed', message: `${provider}: operation cancelled` },
  });
}

export async function dispose(
  state: DisposalState,
  cleanup?: () => Promise<void>
): Promise<void> {
  if (state.isDisposed) return;
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
