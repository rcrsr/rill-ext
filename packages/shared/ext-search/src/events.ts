/**
 * Event emission helper for search extensions.
 * Emits success and error events with timing metadata.
 */

import { emitExtensionEvent, type RuntimeContext } from '@rcrsr/rill';

/**
 * Emit a success event for a completed search operation.
 *
 * @param ctx - Runtime context for event emission
 * @param provider - Provider name (e.g., "exa", "tavily")
 * @param operation - Operation name (e.g., "search")
 * @param duration - Elapsed time in milliseconds
 * @param query - Search query string
 * @param resultCount - Number of results returned
 */
export function emitSuccessEvent(
  ctx: RuntimeContext,
  provider: string,
  operation: string,
  duration: number,
  query: string,
  resultCount: number
): void {
  emitExtensionEvent(ctx, {
    event: `${provider}:${operation}`,
    subsystem: `extension:${provider}`,
    duration,
    query,
    result_count: resultCount,
  });
}

/**
 * Emit an error event for a failed search operation.
 *
 * @param ctx - Runtime context for event emission
 * @param provider - Provider name (e.g., "exa", "tavily")
 * @param duration - Elapsed time in milliseconds
 * @param error - Error message string
 */
export function emitErrorEvent(
  ctx: RuntimeContext,
  provider: string,
  duration: number,
  error: string
): void {
  emitExtensionEvent(ctx, {
    event: `${provider}:error`,
    subsystem: `extension:${provider}`,
    duration,
    error,
  });
}
