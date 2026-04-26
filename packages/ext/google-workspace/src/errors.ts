/**
 * Error mapping utilities for Google Workspace extension.
 * Converts Google API HTTP errors and network failures
 * to RuntimeError with spec-defined messages.
 */

import { RuntimeError } from '@rcrsr/rill';

/** Map service identifier to display-capitalized name. */
function capitalizeService(service: 'gmail' | 'drive' | 'calendar'): string {
  if (service === 'gmail') return 'Gmail';
  if (service === 'drive') return 'Drive';
  return 'Calendar';
}

/**
 * Map a Google API HTTP error response to RuntimeError.
 * Applies spec-defined messages for each status code.
 *
 * @param status - HTTP response status code
 * @param service - Google service that returned the error
 * @param operation - Operation name for 403 scope message (e.g., 'send', 'download')
 * @param id - Resource identifier for 404 message (optional)
 * @returns RuntimeError (RILL-R004) with spec-defined message [EC-14..EC-18]
 */
export function mapGoogleError(
  status: number,
  service: 'gmail' | 'drive' | 'calendar',
  operation: string,
  id?: string | undefined
): RuntimeError {
  const svc = capitalizeService(service);

  // EC-14 (401): Invalid token
  if (status === 401) {
    return new RuntimeError('RILL-R004', `google: invalid ${svc} token`);
  }

  // EC-15 (403): Insufficient scopes
  if (status === 403) {
    return new RuntimeError(
      'RILL-R004',
      `google: insufficient ${svc} scopes for ${operation}`
    );
  }

  // EC-16 (404): Resource not found
  if (status === 404) {
    // Drive uses "file"; Gmail and Calendar use "resource"
    const resourceWord = service === 'drive' ? 'file' : 'resource';
    if (id !== undefined) {
      return new RuntimeError(
        'RILL-R004',
        `google: ${svc} ${resourceWord} '${id}' not found`
      );
    }
    return new RuntimeError(
      'RILL-R004',
      `google: ${svc} ${resourceWord} not found`
    );
  }

  // EC-17 (429): Rate limit exceeded — no service prefix
  if (status === 429) {
    return new RuntimeError(
      'RILL-R004',
      'google: rate limit exceeded; retry after delay'
    );
  }

  // EC-18 (5xx): Server error
  if (status >= 500 && status <= 599) {
    return new RuntimeError(
      'RILL-R004',
      `google: ${svc} server error (${status}); temporarily unavailable`
    );
  }

  // Other HTTP errors: generic fallback
  return new RuntimeError(
    'RILL-R004',
    `google: ${svc} request failed (${status})`
  );
}

/**
 * Map a fetch network error to RuntimeError.
 * AbortError maps to request timeout; TypeError maps to connection failed.
 *
 * @param error - Error caught from fetch operation
 * @param service - Service name (lowercase) for connection failure message
 * @returns RuntimeError (RILL-R004) with spec-defined message [EC-19, EC-20]
 */
export function mapFetchError(error: unknown, service: string): RuntimeError {
  // AbortError: request timed out (EC-19)
  if (error instanceof Error && error.name === 'AbortError') {
    return new RuntimeError('RILL-R004', 'google: request timeout');
  }

  // TypeError: network failure (DNS, connection refused, etc.)
  if (error instanceof TypeError) {
    return new RuntimeError(
      'RILL-R004',
      `google: ${service} connection failed`
    );
  }

  // Already a RuntimeError: pass through
  if (error instanceof RuntimeError) {
    return error;
  }

  // Unknown error: use message if available
  const message = error instanceof Error ? error.message : String(error);
  return new RuntimeError(
    'RILL-R004',
    `google: ${service} request failed: ${message}`
  );
}
