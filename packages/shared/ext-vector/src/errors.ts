/**
 * Error mapping utilities for vector database extensions.
 *
 * Converts SDK-specific errors into invalid RillValues via
 * `ctx.invalidate`, using rill core's pre-registered generic atoms
 * (`#TIMEOUT`, `#AUTH`, `#RATE_LIMIT`, `#NOT_FOUND`, `#CONFLICT`,
 * `#TYPE_MISMATCH`, `#UNAVAILABLE`).
 *
 * Provider-specific failures decompose into
 * (generic atom, meta.provider, meta.raw.kind). Host scripts match
 * coarsely (`guard #UNAVAILABLE`) or finely
 * (`guard #TYPE_MISMATCH && raw.kind == 'dimension_mismatch'`).
 */

import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

/**
 * Convert SDK error to an invalid RillValue with provider-prefixed message.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param provider - Provider name (e.g., "chroma", "pinecone", "qdrant")
 * @param error - Error from SDK operation
 */
export function mapVectorError(
  ctx: RuntimeContext,
  provider: string,
  error: unknown
): RillValue {
  // RuntimeHaltSignal — cooperative cancellation
  if (error instanceof RuntimeHaltSignal) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: {
        kind: 'request_cancelled',
        message: `${provider}: request cancelled`,
      },
    });
  }

  // Non-Error value thrown
  if (!(error instanceof Error)) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'unknown_error', message: `${provider}: unknown error` },
    });
  }

  const message = error.message;

  // Status 401 or "unauthorized" in message
  if (
    message.includes('401') ||
    message.toLowerCase().includes('unauthorized')
  ) {
    return ctx.invalidate(error, {
      code: 'AUTH',
      provider,
      raw: {
        kind: 'authentication_failed',
        status: 401,
        message: `${provider}: authentication failed (401)`,
      },
    });
  }

  // "collection"/"index" + "not found" in message
  const lower = message.toLowerCase();
  if (
    (lower.includes('collection') || lower.includes('index')) &&
    lower.includes('not found')
  ) {
    return ctx.invalidate(error, {
      code: 'NOT_FOUND',
      provider,
      raw: {
        kind: 'collection_not_found',
        message: `${provider}: collection not found`,
      },
    });
  }

  // Status 429 or "rate limit" in message
  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return ctx.invalidate(error, {
      code: 'RATE_LIMIT',
      provider,
      raw: {
        kind: 'rate_limit_exceeded',
        message: `${provider}: rate limit exceeded`,
      },
    });
  }

  // AbortError name or "timeout" in message — treat as timeout
  if (
    error.name === 'AbortError' ||
    message.toLowerCase().includes('timeout')
  ) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_timeout', message: `${provider}: request timeout` },
    });
  }

  // "dimension" in message
  if (message.toLowerCase().includes('dimension')) {
    const match = message.match(
      /expected (\d+).*got (\d+)|(\d+).*?expected.*?(\d+)/i
    );
    if (match) {
      const expected = match[1] || match[4];
      const actual = match[2] || match[3];
      return ctx.invalidate(error, {
        code: 'TYPE_MISMATCH',
        provider,
        raw: {
          kind: 'dimension_mismatch',
          expected: Number(expected),
          actual: Number(actual),
          message: `${provider}: dimension mismatch (expected ${expected}, got ${actual})`,
        },
      });
    }
    return ctx.invalidate(error, {
      code: 'TYPE_MISMATCH',
      provider,
      raw: {
        kind: 'dimension_mismatch',
        message: `${provider}: dimension mismatch`,
      },
    });
  }

  // "already exists" in message
  if (message.toLowerCase().includes('already exists')) {
    return ctx.invalidate(error, {
      code: 'CONFLICT',
      provider,
      raw: {
        kind: 'collection_exists',
        message: `${provider}: collection already exists`,
      },
    });
  }

  // TypeError → network/connection failure
  if (error instanceof TypeError) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'connection_failed', message: `${provider}: ${message}` },
    });
  }

  // Generic Error instance
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider,
    raw: { kind: 'sdk_error', message: `${provider}: ${message}` },
  });
}
