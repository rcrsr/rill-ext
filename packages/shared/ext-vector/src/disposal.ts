import { RuntimeHaltSignal, type RuntimeContext } from '@rcrsr/rill';
import type { DisposalState } from './types.js';

/**
 * Create a mutable disposal state tracker initialized to not-disposed.
 * @param _provider - Extension provider name (reserved for future error context)
 */
export function createDisposalState(_provider: string): DisposalState {
  return { isDisposed: false };
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
  const error = new Error(`${provider}: operation cancelled`);
  const invalid = ctx.invalidate(error, {
    code: 'DISPOSED',
    provider,
    raw: {
      kind: 'extension_disposed',
      message: `${provider}: operation cancelled`,
    },
  });
  return new RuntimeHaltSignal(invalid, true);
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
