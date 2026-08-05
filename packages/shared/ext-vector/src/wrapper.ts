/**
 * Function wrapper factory for vector database extensions.
 * Disposal and errors surface as invalid RillValues via ctx.invalidate;
 * the wrapped function never throws.
 */

import {
  emitExtensionEvent,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { DisposalState } from './types.js';
import { checkDisposed } from './disposal.js';
import { mapVectorError } from './errors.js';

/**
 * Create a function wrapper that adds disposal check, timing, events,
 * and error mapping. Vector SDKs that cannot accept a per-call signal
 * dispose themselves on `ctx.signal.abort` from the consuming
 * extension's factory.
 */
export function createFunctionWrapper(
  provider: string,
  state: DisposalState
): (
  operation: string,
  fn: (
    args: Record<string, RillValue>,
    ctx: RuntimeContext
  ) => Promise<RillValue>,
  metadata?: (args: Record<string, RillValue>) => Record<string, unknown>
) => (
  args: Record<string, RillValue>,
  ctx: RuntimeContext
) => Promise<RillValue> {
  return (operation, fn, metadata) => {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      // Check disposal state first
      const disposed = checkDisposed(ctx, state, provider);
      if (disposed !== null) return disposed;

      const startTime = Date.now();
      try {
        const result = await fn(args, ctx);
        const duration = Date.now() - startTime;
        emitExtensionEvent(ctx, {
          event: `${provider}:${operation}`,
          subsystem: `extension:${provider}`,
          duration,
          ...(metadata ? metadata(args) : {}),
        });
        return result;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const invalid = mapVectorError(ctx, provider, error);
        const status = getStatus(invalid);
        emitExtensionEvent(ctx, {
          event: `${provider}:error`,
          subsystem: `extension:${provider}`,
          error: status.message,
          duration,
        });
        return invalid;
      }
    };
  };
}
