/**
 * Error mapping utilities for Outlook extension.
 * Converts Microsoft Graph API HTTP errors and network failures
 * to RuntimeError with spec-defined messages.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Map a Graph API HTTP error response to RuntimeError.
 * Applies spec-defined messages for each status code.
 *
 * @param status - HTTP response status code
 * @param operation - Operation name for 403 permission message (e.g., 'send', 'read')
 * @param id - Resource identifier for 404 message (e.g., message ID)
 * @returns RuntimeError (RILL-R004) with spec-defined message [EC-12]
 */
export function mapGraphError(
  status: number,
  operation: string,
  id?: string | undefined
): RuntimeError {
  // 401: Authentication failed
  if (status === 401) {
    return new RuntimeError(
      'RILL-R004',
      'outlook: authentication failed (401)'
    );
  }

  // 403: Insufficient permissions for operation
  if (status === 403) {
    return new RuntimeError(
      'RILL-R004',
      `outlook: insufficient permissions for ${operation}`
    );
  }

  // 404: Resource not found
  if (status === 404) {
    const identifier = id ?? operation;
    return new RuntimeError(
      'RILL-R004',
      `outlook: message '${identifier}' not found`
    );
  }

  // 429: Rate limit exceeded
  if (status === 429) {
    return new RuntimeError('RILL-R004', 'outlook: rate limit exceeded');
  }

  // 5xx: Server error
  if (status >= 500 && status <= 599) {
    return new RuntimeError(
      'RILL-R004',
      `outlook: server error (${status})`
    );
  }

  // Other HTTP errors: generic message
  return new RuntimeError(
    'RILL-R004',
    `outlook: request failed (${status})`
  );
}

/**
 * Map a fetch network error to RuntimeError.
 * AbortError maps to request timeout; TypeError maps to connection failed.
 *
 * @param error - Error caught from fetch operation
 * @returns RuntimeError (RILL-R004) with spec-defined message [EC-12]
 */
export function mapFetchError(error: unknown): RuntimeError {
  // AbortError: request timed out or was cancelled
  if (error instanceof Error && error.name === 'AbortError') {
    return new RuntimeError('RILL-R004', 'outlook: request timeout');
  }

  // TypeError: network failure (DNS, connection refused, etc.)
  if (error instanceof TypeError) {
    return new RuntimeError('RILL-R004', 'outlook: connection failed');
  }

  // Already a RuntimeError: pass through
  if (error instanceof RuntimeError) {
    return error;
  }

  // Unknown error: use message if available
  const message = error instanceof Error ? error.message : String(error);
  return new RuntimeError('RILL-R004', `outlook: ${message}`);
}
