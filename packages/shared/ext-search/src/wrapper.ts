/**
 * Function wrapper factory for search extensions.
 * Combines disposal check, in-flight tracking, timing, event emission,
 * and error mapping. Errors and disposal both surface as invalid
 * RillValues via `ctx.invalidate`; the wrapped function never throws.
 */

import { type RillValue, type RuntimeContext, getStatus } from '@rcrsr/rill';
import type { DisposalState, InFlightState } from './types.js';
import { checkDisposed } from './disposal.js';
import { trackRequest } from './request.js';
import { mapSearchError } from './errors.js';
import { emitSuccessEvent, emitErrorEvent } from './events.js';

/** Atom names supplied by the consuming extension at factory init. */
export interface SearchWrapperAtoms {
  /** Atom registered for the disposed/cancelled state. */
  readonly disposedCode: string;
  /** Atom registered for HTTP / generic operation failures. */
  readonly errorCode: string;
}

/**
 * Type for a wrapped host function.
 *
 * The inner `fn` receives an `AbortSignal` composed from the extension
 * lifecycle signal (when present on `ctx`) and a per-request controller
 * tracked in `inFlightState`. It must propagate the signal to its fetch
 * call so that `dispose()` and host-level cancellation abort in-flight
 * work.
 */
export type WrapFunction = (
  operation: string,
  fn: (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    signal: AbortSignal
  ) => Promise<{ result: RillValue; query: string; resultCount: number }>
) => (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue>;

/**
 * Create a function wrapper that adds disposal check, in-flight tracking,
 * timing, event emission, and error mapping.
 *
 * The returned `wrap` factory wraps individual host function operations:
 * 1. Check disposal state; return invalid value when disposed.
 * 2. Create an AbortController and register it in inFlightState.
 * 3. Compose `ctx.signal` (if present) with the per-request controller.
 * 4. Record start time.
 * 5. Invoke the operation with the composed signal.
 * 6. Remove the controller from inFlightState after completion.
 * 7. Emit success / error events with duration metadata.
 * 8. Map errors via {@link mapSearchError} to an invalid RillValue.
 *
 * @param provider - Extension provider name (e.g., "exa", "tavily")
 * @param disposalState - DisposalState to check before operations
 * @param inFlightState - InFlightState to register controllers with
 * @param atoms - Atom names registered by the consuming extension
 */
export function createSearchFunctionWrapper(
  provider: string,
  disposalState: DisposalState,
  inFlightState: InFlightState,
  atoms: SearchWrapperAtoms
): WrapFunction {
  return (operation, fn) => {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      // IR-3: Check disposal before execution
      const disposedResult = checkDisposed(
        ctx,
        disposalState,
        provider,
        atoms.disposedCode
      );
      if (disposedResult !== null) {
        return disposedResult;
      }

      // Create AbortController, register in inFlightState
      const controller = new AbortController();
      trackRequest(inFlightState, controller);

      // Compose ctx.signal (when present) with the per-request controller
      const signal: AbortSignal =
        ctx.signal !== undefined
          ? AbortSignal.any([ctx.signal, controller.signal])
          : controller.signal;

      const startTime = Date.now();

      try {
        const { result, query, resultCount } = await fn(args, ctx, signal);
        const duration = Date.now() - startTime;
        emitSuccessEvent(ctx, provider, operation, duration, query, resultCount);
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const invalid = mapSearchError(ctx, provider, error, atoms.errorCode);
        const status = getStatus(invalid);
        emitErrorEvent(ctx, provider, duration, status.message);
        return invalid;
      } finally {
        inFlightState.controllers.delete(controller);
      }
    };
  };
}
