/**
 * Function wrapper factory for search extensions.
 * Combines disposal check, in-flight tracking, timing, event emission,
 * and error mapping. Errors and disposal both surface as invalid
 * RillValues via `ctx.invalidate`; the wrapped function never throws.
 *
 * Emits rill-core generic atoms (`#TIMEOUT`, `#DISPOSED`, `#UNAVAILABLE`,
 * etc.) directly. No per-extension atom registration required.
 */

import { type RillValue, type RuntimeContext, getStatus, isInvalid } from '@rcrsr/rill';
import type { DisposalState, InFlightState } from './types.js';
import { checkDisposed } from './disposal.js';
import { trackRequest } from './request.js';
import { mapSearchError } from './errors.js';
import { emitSuccessEvent, emitErrorEvent } from './events.js';

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
 * @param provider - Extension provider name (e.g., "exa", "tavily")
 * @param disposalState - DisposalState to check before operations
 * @param inFlightState - InFlightState to register controllers with
 */
export function createSearchFunctionWrapper(
  provider: string,
  disposalState: DisposalState,
  inFlightState: InFlightState
): WrapFunction {
  return (operation, fn) => {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      const disposedResult = checkDisposed(ctx, disposalState, provider);
      if (disposedResult !== null) {
        return disposedResult;
      }

      const controller = new AbortController();
      trackRequest(inFlightState, controller);

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
        const invalid =
          isInvalid(error as RillValue)
            ? (error as RillValue)
            : mapSearchError(ctx, provider, error);
        const status = getStatus(invalid);
        emitErrorEvent(ctx, provider, duration, status.message);
        return invalid;
      } finally {
        inFlightState.controllers.delete(controller);
      }
    };
  };
}
