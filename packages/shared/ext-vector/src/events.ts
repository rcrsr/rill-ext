/**
 * Event emission wrapper for vector database extensions.
 * Wraps async operations with start-time recording, success event
 * emission, and error event emission. On failure, returns an invalid
 * RillValue mapped via {@link mapVectorError}.
 */

import {
  emitExtensionEvent,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { mapVectorError } from './errors.js';

/**
 * Wrap async operation with start-time recording and event emission.
 *
 * @param ctx - Runtime context for event emission and `invalidate`
 * @param provider - Provider name (e.g., "chroma", "pinecone", "qdrant")
 * @param operation - Operation name (e.g., "upsert", "query", "delete")
 * @param metadata - Additional metadata to include in success event
 * @param fn - Async operation to execute
 * @param errorCode - Atom name registered by the consuming extension for API errors
 * @returns Promise resolving to operation result, or an invalid RillValue on error
 */
export async function withEventEmission<T extends RillValue>(
  ctx: RuntimeContext,
  provider: string,
  operation: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
  errorCode: string
): Promise<T | RillValue> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    emitExtensionEvent(ctx, {
      event: `${provider}:${operation}`,
      subsystem: `extension:${provider}`,
      duration,
      ...metadata,
    });
    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const invalid = mapVectorError(ctx, provider, error, errorCode);
    const status = getStatus(invalid);
    emitExtensionEvent(ctx, {
      event: `${provider}:error`,
      subsystem: `extension:${provider}`,
      error: status.message,
      duration,
    });
    return invalid;
  }
}
