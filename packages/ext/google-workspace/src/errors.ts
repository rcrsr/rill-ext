/**
 * Error mapping utilities for Google Workspace extension.
 *
 * Converts Google API HTTP errors and fetch failures into invalid
 * RillValues via `ctx.invalidate`, using rill core's pre-registered
 * generic atoms (`#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#NOT_FOUND`,
 * `#RATE_LIMIT`, `#UNAVAILABLE`).
 *
 * Provider-specific failure shape: (generic atom, meta.provider='google-workspace',
 * meta.raw.kind, meta.raw.service). Spec EC-14..EC-20 message strings
 * are preserved on `meta.raw.message`.
 */

import {
  RuntimeHaltSignal,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

const PROVIDER = 'google-workspace';

function capitalizeService(service: 'gmail' | 'drive' | 'calendar'): string {
  if (service === 'gmail') return 'Gmail';
  if (service === 'drive') return 'Drive';
  return 'Calendar';
}

/**
 * Map a Google API HTTP error response to an invalid RillValue.
 * The wrapper passes invalid throws through unchanged.
 */
export function mapGoogleError(
  ctx: RuntimeContext,
  status: number,
  service: 'gmail' | 'drive' | 'calendar',
  operation: string,
  id?: string | undefined
): RillValue {
  const svc = capitalizeService(service);

  if (status === 401) {
    const message = `google: invalid ${svc} token`;
    return ctx.invalidate(new Error(message), {
      code: 'AUTH',
      provider: PROVIDER,
      raw: { kind: 'invalid_token', status, service, message },
    });
  }

  if (status === 403) {
    const message = `google: insufficient ${svc} scopes for ${operation}`;
    return ctx.invalidate(new Error(message), {
      code: 'FORBIDDEN',
      provider: PROVIDER,
      raw: { kind: 'insufficient_scopes', status, service, operation, message },
    });
  }

  if (status === 404) {
    const resourceWord = service === 'drive' ? 'file' : 'resource';
    const message =
      id !== undefined
        ? `google: ${svc} ${resourceWord} '${id}' not found`
        : `google: ${svc} ${resourceWord} not found`;
    return ctx.invalidate(new Error(message), {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: { kind: 'not_found', status, service, id, message },
    });
  }

  if (status === 429) {
    const message = 'google: rate limit exceeded; retry after delay';
    return ctx.invalidate(new Error(message), {
      code: 'RATE_LIMIT',
      provider: PROVIDER,
      raw: { kind: 'rate_limit_exceeded', status, service, message },
    });
  }

  if (status >= 500 && status <= 599) {
    const message = `google: ${svc} server error (${status}); temporarily unavailable`;
    return ctx.invalidate(new Error(message), {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'server_error', status, service, message },
    });
  }

  const message = `google: ${svc} request failed (${status})`;
  return ctx.invalidate(new Error(message), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'http_error', status, service, message },
  });
}

/**
 * Map a fetch network error to an invalid RillValue.
 *
 * - `RuntimeHaltSignal` with `#TIMEOUT` → request cancelled by host.
 * - `AbortError` → request timed out.
 * - `TypeError` → DNS / connection failure.
 * - Other → generic unavailability.
 */
export function mapFetchError(
  ctx: RuntimeContext,
  error: unknown,
  service: string
): RillValue {
  if (
    error instanceof RuntimeHaltSignal &&
    getStatus(error.value).code.name === 'TIMEOUT'
  ) {
    const message = 'google: request cancelled';
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_cancelled', service, message },
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    const message = 'google: request timeout';
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_timeout', service, message },
    });
  }

  if (error instanceof TypeError) {
    const message = `google: ${service} connection failed`;
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: PROVIDER,
      raw: { kind: 'network_error', service, message },
    });
  }

  const detail = error instanceof Error ? error.message : String(error);
  const message = `google: ${service} request failed: ${detail}`;
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'unknown_error', service, message },
  });
}

/**
 * Build and throw an invalid RillValue carrying `#INVALID_INPUT`.
 * Convenience for in-function argument validation.
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
 * Build and throw an invalid RillValue carrying `#FORBIDDEN`.
 * Convenience for capability gate denials.
 */
export function failForbidden(
  ctx: RuntimeContext,
  kind: string,
  message: string
): never {
  throw ctx.invalidate(new Error(message), {
    code: 'FORBIDDEN',
    provider: PROVIDER,
    raw: { kind, message },
  }) as unknown as RillValue;
}

/**
 * Build and throw an invalid RillValue carrying `#AUTH`.
 * Convenience for token-resolution failures.
 */
export function failAuth(
  ctx: RuntimeContext,
  kind: string,
  message: string,
  raw?: Record<string, unknown>
): never {
  throw ctx.invalidate(new Error(message), {
    code: 'AUTH',
    provider: PROVIDER,
    raw: { kind, message, ...(raw ?? {}) },
  }) as unknown as RillValue;
}
