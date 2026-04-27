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

/** Atom names supplied by the consuming extension at factory init. */
export interface VectorWrapperAtoms {
  /** Atom registered for the disposed/cancelled state. */
  readonly disposedCode: string;
  /** Atom registered for SDK / API failures. */
  readonly errorCode: string;
}

/**
 * Create a function wrapper that adds disposal check, timing, events,
 * and error mapping. Composes `ctx.signal` lifecycle into per-call
 * cancellation via `signal` argument. Vector SDKs that cannot accept a
 * per-call signal must dispose themselves on `ctx.signal.abort` from
 * the consuming extension's factory.
 */
export function createFunctionWrapper(
  provider: string,
  state: DisposalState,
  atoms: VectorWrapperAtoms
): (
  operation: string,
  fn: (
    args: Record<string, RillValue>,
    ctx: RuntimeContext
  ) => Promise<RillValue>,
  metadata?: (args: Record<string, RillValue>) => Record<string, unknown>
) => (args: Record<string, RillValue>, ctx: RuntimeContext) => Promise<RillValue> {
  return (operation, fn, metadata) => {
    return async (
      args: Record<string, RillValue>,
      ctx: RuntimeContext
    ): Promise<RillValue> => {
      // EC-20: Check disposal state first
      const disposed = checkDisposed(ctx, state, provider, atoms.disposedCode);
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
        const invalid = mapVectorError(ctx, provider, error, atoms.errorCode);
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
