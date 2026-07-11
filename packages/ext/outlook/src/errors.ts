/**
 * Error mapping utilities for Outlook extension.
 *
 * Converts Microsoft Graph HTTP errors and fetch failures into invalid
 * RillValues via `ctx.invalidate`, using rill core's pre-registered
 * generic atoms (`#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#NOT_FOUND`,
 * `#RATE_LIMIT`, `#UNAVAILABLE`).
 *
 * Provider-specific failure shape: (generic atom, meta.provider='outlook',
 * meta.raw.kind, meta.raw.status). Spec-defined message strings (EC-12)
 * are preserved on `meta.raw.message` so host scripts can `guard
 * #UNAVAILABLE && raw.kind == 'server_error'`.
 */

import {
  RuntimeHaltSignal,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

const PROVIDER = 'outlook';

/**
 * Build and throw an invalid RillValue carrying `#INVALID_INPUT`.
 * Convenience for in-function argument validation; the wrap()'s catch
 * passes the invalid value through unchanged.
 */
export function failInput(
  ctx: RuntimeContext,
  kind: string,
  message: string
): never {
  throw ctx.invalidate(new Error(message), {
    code: 'INVALID_INPUT',
    provider: PROVIDER,
    raw: { kind, message },
  }) as unknown as RillValue;
}

/**
 * Map a Graph API HTTP error response to an invalid RillValue.
 * The wrapper passes invalid throws through unchanged.
 */
export function mapGraphError(
  ctx: RuntimeContext,
  status: number,
  operation: string,
  id?: string | undefined
): RillValue {
  if (status === 401) {
    const message = 'outlook: authentication failed (401)';
    return ctx.invalidate(new Error(message), {
      code: 'AUTH',
      provider: PROVIDER,
      raw: { kind: 'authentication_failed', status, message },
    });
  }

  if (status === 403) {
    const message = `outlook: insufficient permissions for ${operation}`;
    return ctx.invalidate(new Error(message), {
      code: 'FORBIDDEN',
      provider: PROVIDER,
      raw: { kind: 'insufficient_permissions', status, operation, message },
    });
  }

  if (status === 404) {
    const identifier = id ?? operation;
    const message = `outlook: message '${identifier}' not found`;
    return ctx.invalidate(new Error(message), {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: { kind: 'not_found', status, id: identifier, message },
    });
  }

  if (status === 429) {
    const message = 'outlook: rate limit exceeded';
    return ctx.invalidate(new Error(message), {
      code: 'RATE_LIMIT',
      provider: PROVIDER,
      raw: { kind: 'rate_limit_exceeded', status, message },
    });
  }

  if (status >= 500 && status <= 599) {
    const message = `outlook: server error (${status})`;
    return ctx.invalidate(new Error(message), {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'server_error', status, message },
    });
  }

  const message = `outlook: request failed (${status})`;
  return ctx.invalidate(new Error(message), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'http_error', status, message },
  });
}

/**
 * Map a fetch network error to an invalid RillValue.
 *
 * - `RuntimeHaltSignal` with `#TIMEOUT` atom → request cancelled by host.
 * - `AbortError` (DOMException from undici) → request timed out.
 * - `TypeError` → DNS / connection failure.
 * - Anything else → generic unavailability.
 */
export function mapFetchError(ctx: RuntimeContext, error: unknown): RillValue {
  if (
    error instanceof RuntimeHaltSignal &&
    getStatus(error.value).code.name === 'TIMEOUT'
  ) {
    const message = 'outlook: request cancelled';
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_cancelled', message },
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    const message = 'outlook: request timeout';
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_timeout', message },
    });
  }

  if (error instanceof TypeError) {
    const message = 'outlook: connection failed';
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'network_error', message },
    });
  }

  const detail = error instanceof Error ? error.message : String(error);
  const message = `outlook: ${detail}`;
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'unknown_error', message },
  });
}
