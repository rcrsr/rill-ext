/**
 * Function wrapper factory for search extensions.
 * Combines disposal check, in-flight tracking, timing, event emission, and error mapping.
 */

import { type RillValue, type RuntimeContext } from '@rcrsr/rill';
import type { DisposalState, InFlightState } from './types.js';
import { checkDisposed } from './disposal.js';
import { trackRequest } from './request.js';
import { mapSearchError } from './errors.js';
import { emitSuccessEvent, emitErrorEvent } from './events.js';

/**
 * Type for a wrapped host function that executes with disposal protection,
 * in-flight tracking, timing, and event emission.
 */
export type WrapFunction = (
  operation: string,
  fn: (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ) => Promise<{ result: RillValue; query: string; resultCount: number }>
) => (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue>;

/**
 * Create a function wrapper that adds disposal check, in-flight tracking,
 * timing, event emission, and error mapping.
 *
 * The returned `wrap` function wraps individual host function operations:
 * 1. Checks disposal state; throws RILL-R004 if disposed
 * 2. Creates an AbortController and registers it in inFlightState
 * 3. Records start time
 * 4. Invokes the operation function with the controller
 * 5. Removes the controller from inFlightState after completion
 * 6. Emits success event with duration, query, and result_count on success
 * 7. Maps errors via mapSearchError and emits error event on failure
 *
 * @param provider - Extension provider name (e.g., "exa", "tavily")
 * @param disposalState - DisposalState to check before operations
 * @param inFlightState - InFlightState to register controllers with
 * @returns WrapFunction factory
 *
 * @example
 * ```typescript
 * const wrap = createSearchFunctionWrapper('exa', disposalState, inFlightState);
 *
 * const search = wrap('search', async (args, ctx, controller) => {
 *   const result = await fetchSearch(args, controller.signal);
 *   return { result, query: String(args['query']), resultCount: result.length };
 * });
 * ```
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
      // IR-3: Check disposal state before execution
      checkDisposed(disposalState, provider);

      // Create AbortController and register in inFlightState
      const controller = new AbortController();
      trackRequest(inFlightState, controller);

      // Record start time
      const startTime = Date.now();

      try {
        // Execute wrapped function with controller
        const { result, query, resultCount } = await fn(args, ctx, controller);

        // Calculate duration
        const duration = Date.now() - startTime;

        // IR-3: Emit success event
        emitSuccessEvent(ctx, provider, operation, duration, query, resultCount);

        return result;
      } catch (error: unknown) {
        // Calculate duration
        const duration = Date.now() - startTime;

        // Map error via mapSearchError
        const mappedError = mapSearchError(provider, error);

        // IR-3: Emit error event
        emitErrorEvent(ctx, provider, duration, mappedError.message);

        // Throw mapped error
        throw mappedError;
      } finally {
        // IR-3: Remove controller from inFlightState after completion
        inFlightState.controllers.delete(controller);
      }
    };
  };
}
