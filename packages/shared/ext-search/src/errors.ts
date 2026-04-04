/**
 * Error mapping utilities for search extensions.
 * Converts HTTP errors and network failures to RuntimeError with standardized messages.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Convert a fetch error or network failure to RuntimeError with provider-prefixed messages.
 *
 * Maps error conditions by AbortError name, TypeError constructor, or HTTP status codes
 * to standardized RuntimeError instances with error code RILL-R004.
 *
 * @param provider - Provider name (e.g., "exa", "tavily", "serper", "brave")
 * @param error - Error caught from fetch operation
 * @returns RuntimeError with provider-prefixed message
 */
export function mapSearchError(provider: string, error: unknown): RuntimeError {
  // EC-4: AbortError name — request was cancelled or timed out
  if (error instanceof Error && error.name === 'AbortError') {
    return new RuntimeError('RILL-R004', `${provider}: request timeout`);
  }

  // EC-5: TypeError — network failure (DNS, connection refused, etc.)
  if (error instanceof TypeError) {
    return new RuntimeError('RILL-R004', `${provider}: connection failed`);
  }

  // EC-6: Non-JSON response indicated by SyntaxError from JSON.parse
  if (error instanceof SyntaxError) {
    return new RuntimeError(
      'RILL-R004',
      `${provider}: unexpected response format`
    );
  }

  // Re-throw already-mapped RuntimeError
  if (error instanceof RuntimeError) {
    return error;
  }

  // EC-1/2/3: HTTP error objects with a status property (constructed by operation functions)
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;

    // EC-1: HTTP 401 or 403 — authentication failure
    if (status === 401 || status === 403) {
      return new RuntimeError(
        'RILL-R004',
        `${provider}: authentication failed`
      );
    }

    // EC-2: HTTP 429 — rate limit
    if (status === 429) {
      return new RuntimeError('RILL-R004', `${provider}: rate limit exceeded`);
    }

    // EC-3: HTTP 5xx — server error
    if (status >= 500 && status <= 599) {
      return new RuntimeError(
        'RILL-R004',
        `${provider}: server error (${status})`
      );
    }
  }

  // EC-7: Unknown error — use message if available
  const message =
    error instanceof Error ? error.message : String(error);
  return new RuntimeError('RILL-R004', `${provider}: ${message}`);
}

/**
 * Map provider-specific HTTP status codes and response bodies to RuntimeError.
 *
 * Called after fetch returns a non-OK response and the body has been parsed.
 * Applies provider-specific overrides before falling back to mapSearchError
 * generic HTTP status code mapping.
 *
 * @param provider - Provider name (e.g., "exa", "tavily", "serper", "brave")
 * @param status - HTTP response status code
 * @param body - Parsed response body (may be any JSON value)
 * @returns RuntimeError with provider-prefixed message
 */
export function mapProviderSearchError(
  provider: string,
  status: number,
  body: unknown
): RuntimeError {
  // EC-8: Exa 402 — credits depleted
  if (provider === 'exa' && status === 402) {
    return new RuntimeError('RILL-R004', `exa: credits depleted`);
  }

  // EC-9: Tavily 432 — plan limit exceeded
  if (provider === 'tavily' && status === 432) {
    return new RuntimeError('RILL-R004', `tavily: plan limit exceeded`);
  }

  // EC-10: Tavily 433 — pay-as-you-go limit exceeded
  if (provider === 'tavily' && status === 433) {
    return new RuntimeError(
      'RILL-R004',
      `tavily: pay-as-you-go limit exceeded`
    );
  }

  // EC-11: Brave 403 with error code field — access denied (distinguished from auth failure)
  if (provider === 'brave' && status === 403) {
    const braveBody = body as
      | { error?: { code?: unknown } }
      | null
      | undefined;
    const code = braveBody?.error?.code;
    if (code !== undefined && code !== null) {
      return new RuntimeError(
        'RILL-R004',
        `brave: access denied (${String(code)})`
      );
    }
  }

  // Fall back to generic HTTP status code mapping
  return mapSearchError(provider, { status });
}
