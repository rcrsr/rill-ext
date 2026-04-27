/**
 * Error mapping utilities for search extensions.
 *
 * Converts fetch errors and HTTP failures into invalid RillValues via
 * `ctx.invalidate`. The atom code names (e.g. `EXT_SEARCH_BRAVE_HTTP`)
 * are supplied by each consuming extension; this shared layer is
 * provider-agnostic.
 */

import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

/**
 * Convert a fetch error or network failure to an invalid RillValue.
 *
 * Maps error conditions by RuntimeHaltSignal (timeout/disposal),
 * AbortError name (legacy DOMException from undici), TypeError
 * (network failure), SyntaxError (malformed body), or HTTP status code
 * to an invalid RillValue carrying a registered atom and a structured
 * `raw` payload.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param provider - Provider name (e.g., "exa", "tavily", "serper", "brave")
 * @param error - Error caught from fetch operation
 * @param errorCode - Atom name registered by the consuming extension for HTTP / generic errors
 * @returns Invalid RillValue with provider-prefixed message and structured raw payload
 */
export function mapSearchError(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
  errorCode: string
): RillValue {
  // Halt signal from rill-internal cooperative cancellation
  if (error instanceof RuntimeHaltSignal) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { message: `${provider}: request cancelled` },
    });
  }

  // EC-4: AbortError name — legacy DOMException from native fetch / undici
  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { message: `${provider}: request timeout` },
    });
  }

  // EC-5: TypeError — network failure (DNS, connection refused, etc.)
  if (error instanceof TypeError) {
    return ctx.invalidate(error, {
      code: errorCode,
      provider,
      raw: {
        kind: 'connection_failed',
        message: `${provider}: connection failed`,
      },
    });
  }

  // EC-6: SyntaxError from JSON.parse — non-JSON response
  if (error instanceof SyntaxError) {
    return ctx.invalidate(error, {
      code: errorCode,
      provider,
      raw: {
        kind: 'unexpected_response_format',
        message: `${provider}: unexpected response format`,
      },
    });
  }

  // EC-1/2/3: HTTP error objects with a status property
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;

    // EC-1: HTTP 401 or 403 — authentication failure
    if (status === 401 || status === 403) {
      return ctx.invalidate(error, {
        code: errorCode,
        provider,
        raw: {
          kind: 'authentication_failed',
          status,
          message: `${provider}: authentication failed`,
        },
      });
    }

    // EC-2: HTTP 429 — rate limit
    if (status === 429) {
      return ctx.invalidate(error, {
        code: errorCode,
        provider,
        raw: {
          kind: 'rate_limit_exceeded',
          status,
          message: `${provider}: rate limit exceeded`,
        },
      });
    }

    // EC-3: HTTP 5xx — server error
    if (status >= 500 && status <= 599) {
      return ctx.invalidate(error, {
        code: errorCode,
        provider,
        raw: {
          kind: 'server_error',
          status,
          message: `${provider}: server error (${status})`,
        },
      });
    }
  }

  // EC-7: Unknown error — use message if available
  const message = error instanceof Error ? error.message : String(error);
  return ctx.invalidate(error, {
    code: errorCode,
    provider,
    raw: { message: `${provider}: ${message}` },
  });
}

/**
 * Map provider-specific HTTP status codes and response bodies to an
 * invalid RillValue. Falls back to {@link mapSearchError} for generic
 * status mappings.
 *
 * @param ctx - Runtime context
 * @param provider - Provider name (e.g., "exa", "tavily", "serper", "brave")
 * @param status - HTTP response status code
 * @param body - Parsed response body (any JSON value)
 * @param errorCode - Atom name for HTTP / generic errors
 */
export function mapProviderSearchError(
  ctx: RuntimeContext,
  provider: string,
  status: number,
  body: unknown,
  errorCode: string
): RillValue {
  // EC-8: Exa 402 — credits depleted
  if (provider === 'exa' && status === 402) {
    return ctx.invalidate(new Error('exa: credits depleted'), {
      code: errorCode,
      provider,
      raw: { kind: 'credits_depleted', status, message: 'exa: credits depleted' },
    });
  }

  // EC-9: Tavily 432 — plan limit exceeded
  if (provider === 'tavily' && status === 432) {
    return ctx.invalidate(new Error('tavily: plan limit exceeded'), {
      code: errorCode,
      provider,
      raw: {
        kind: 'plan_limit_exceeded',
        status,
        message: 'tavily: plan limit exceeded',
      },
    });
  }

  // EC-10: Tavily 433 — pay-as-you-go limit exceeded
  if (provider === 'tavily' && status === 433) {
    return ctx.invalidate(new Error('tavily: pay-as-you-go limit exceeded'), {
      code: errorCode,
      provider,
      raw: {
        kind: 'payg_limit_exceeded',
        status,
        message: 'tavily: pay-as-you-go limit exceeded',
      },
    });
  }

  // EC-11: Brave 403 with error code field — access denied
  if (provider === 'brave' && status === 403) {
    const braveBody = body as { error?: { code?: unknown } } | null | undefined;
    const code = braveBody?.error?.code;
    if (code !== undefined && code !== null) {
      const message = `brave: access denied (${String(code)})`;
      return ctx.invalidate(new Error(message), {
        code: errorCode,
        provider,
        raw: { kind: 'access_denied', status, providerCode: String(code), message },
      });
    }
  }

  // Fall back to generic HTTP status code mapping
  return mapSearchError(ctx, provider, { status }, errorCode);
}
