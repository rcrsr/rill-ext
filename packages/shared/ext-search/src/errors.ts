/**
 * Error mapping utilities for search extensions.
 *
 * Converts fetch errors and HTTP failures into invalid RillValues via
 * `ctx.invalidate`, using rill core's pre-registered generic atoms
 * (`#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`,
 * `#NOT_FOUND`, `#CONFLICT`, `#UNAVAILABLE`, `#PROTOCOL`,
 * `#INVALID_INPUT`).
 *
 * Provider-specific failures decompose into
 * (generic atom, meta.provider, meta.raw.kind). Host scripts match
 * coarsely (`guard #UNAVAILABLE`) or finely
 * (`guard #UNAVAILABLE && raw.kind == 'summarizer_key_missing'`).
 */

import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

/**
 * Map an HTTP status code to a generic atom name.
 * Returns `'UNAVAILABLE'` for unrecognized statuses.
 */
function atomForStatus(status: number): string {
  if (status === 401) return 'AUTH';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409 || status === 412) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 402) return 'QUOTA_EXCEEDED';
  if (status >= 500 && status <= 599) return 'UNAVAILABLE';
  if (status >= 400 && status <= 499) return 'INVALID_INPUT';
  return 'UNAVAILABLE';
}

/**
 * Map a status code to a human-readable kind tag for `meta.raw.kind`.
 */
function kindForStatus(status: number): string {
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'request_timeout';
  if (status === 409 || status === 412) return 'conflict';
  if (status === 429) return 'rate_limit_exceeded';
  if (status === 402) return 'quota_exceeded';
  if (status >= 500 && status <= 599) return 'server_error';
  return 'http_error';
}

/**
 * Convert a fetch error or network failure to an invalid RillValue.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param provider - Provider name (e.g., "exa", "tavily", "serper", "brave")
 * @param error - Error caught from fetch operation
 */
export function mapSearchError(
  ctx: RuntimeContext,
  provider: string,
  error: unknown
): RillValue {
  if (error instanceof RuntimeHaltSignal) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_cancelled', message: `${provider}: request cancelled` },
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_timeout', message: `${provider}: request timeout` },
    });
  }

  if (error instanceof TypeError) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'connection_failed', message: `${provider}: connection failed` },
    });
  }

  if (error instanceof SyntaxError) {
    return ctx.invalidate(error, {
      code: 'PROTOCOL',
      provider,
      raw: {
        kind: 'unexpected_response_format',
        message: `${provider}: unexpected response format`,
      },
    });
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;
    const code = atomForStatus(status);
    const kind = kindForStatus(status);
    const message =
      status === 401 ? `${provider}: authentication failed`
      : status === 403 ? `${provider}: forbidden`
      : status === 404 ? `${provider}: not found`
      : status === 429 ? `${provider}: rate limit exceeded`
      : status === 402 ? `${provider}: quota exceeded`
      : status >= 500 ? `${provider}: server error (${status})`
      : `${provider}: request failed (${status})`;

    return ctx.invalidate(error, {
      code,
      provider,
      raw: { kind, status, message },
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider,
    raw: { kind: 'unknown_error', message: `${provider}: ${message}` },
  });
}

/**
 * Map a provider HTTP status + body to an invalid RillValue.
 * Handles provider-specific quirks (Tavily 432/433, Exa 402, Brave 403)
 * by emitting the appropriate generic atom plus a discriminating
 * `meta.raw.kind`. Falls back to {@link mapSearchError} for generic
 * status codes.
 *
 * @param ctx - Runtime context
 * @param provider - Provider name
 * @param status - HTTP response status code
 * @param body - Parsed response body (any JSON value)
 */
export function mapProviderSearchError(
  ctx: RuntimeContext,
  provider: string,
  status: number,
  body: unknown
): RillValue {
  if (provider === 'exa' && status === 402) {
    return ctx.invalidate(new Error('exa: credits depleted'), {
      code: 'QUOTA_EXCEEDED',
      provider,
      raw: { kind: 'credits_depleted', status, message: 'exa: credits depleted' },
    });
  }

  if (provider === 'tavily' && status === 432) {
    return ctx.invalidate(new Error('tavily: plan limit exceeded'), {
      code: 'QUOTA_EXCEEDED',
      provider,
      raw: { kind: 'plan_limit_exceeded', status, message: 'tavily: plan limit exceeded' },
    });
  }

  if (provider === 'tavily' && status === 433) {
    return ctx.invalidate(new Error('tavily: pay-as-you-go limit exceeded'), {
      code: 'QUOTA_EXCEEDED',
      provider,
      raw: {
        kind: 'payg_limit_exceeded',
        status,
        message: 'tavily: pay-as-you-go limit exceeded',
      },
    });
  }

  if (provider === 'brave' && status === 403) {
    const braveBody = body as { error?: { code?: unknown } } | null | undefined;
    const code = braveBody?.error?.code;
    if (code !== undefined && code !== null) {
      const message = `brave: access denied (${String(code)})`;
      return ctx.invalidate(new Error(message), {
        code: 'FORBIDDEN',
        provider,
        raw: { kind: 'access_denied', status, providerCode: String(code), message },
      });
    }
  }

  return mapSearchError(ctx, provider, { status });
}
