/**
 * Error mapping utilities for LLM provider extensions.
 *
 * Converts provider SDK errors into invalid RillValues via
 * `ctx.invalidate`, using rill core's pre-registered generic atoms
 * (`#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`,
 * `#NOT_FOUND`, `#CONFLICT`, `#UNAVAILABLE`, `#PROTOCOL`,
 * `#INVALID_INPUT`).
 *
 * Provider-specific quirks decompose into
 * (generic atom, meta.provider, meta.raw.kind). Host scripts match
 * coarsely (`guard #AUTH`) or finely
 * (`guard #UNAVAILABLE && raw.kind == 'context_length_exceeded'`).
 */

import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { ProviderErrorDetector } from './types.js';

/**
 * Map an HTTP status code to a generic atom name.
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
 * Map a provider SDK error to an invalid RillValue.
 *
 * Returns the invalid value without throwing. Callers that need to halt
 * evaluation (so host scripts can `guard #AUTH` etc.) should pair this
 * with `throwProviderHalt`, or throw `new RuntimeHaltSignal(invalid, true)`.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param provider - Lowercase provider name (e.g., 'anthropic', 'openai', 'gemini', 'foundry')
 * @param error - Error from provider SDK or unknown error
 * @param detect - Provider callback that returns status code + message, or null
 */
export function mapProviderError(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
  detect: ProviderErrorDetector
): RillValue {
  // meta.provider is the machine-readable, lowercase id (matches the in-package
  // haltInvalid path, per the documented convention). Human-readable messages
  // keep the caller's original casing.
  const providerId = provider.toLowerCase();

  // A RuntimeHaltSignal already carries an invalid value with its own atom
  // (#AUTH, #FORBIDDEN, max_errors_exceeded, …). Preserve it — remapping to
  // #TIMEOUT would erase the reason a script guards on.
  if (error instanceof RuntimeHaltSignal) {
    return error.value;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: providerId,
      raw: {
        kind: 'request_timeout',
        message: `${provider} error: ${error.message}`,
      },
    });
  }

  const detected = detect(error);
  if (detected !== null) {
    const { status, message } = detected;
    if (status !== undefined) {
      return ctx.invalidate(error, {
        code: atomForStatus(status),
        provider: providerId,
        raw: {
          kind: kindForStatus(status),
          status,
          message: `${provider} API error (HTTP ${status}): ${message}`,
        },
      });
    }
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: providerId,
      raw: {
        kind: 'provider_error',
        message: `${provider} API error: ${message}`,
      },
    });
  }

  if (error instanceof TypeError) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: providerId,
      raw: {
        kind: 'connection_failed',
        message: `${provider} error: ${error.message}`,
      },
    });
  }

  if (error instanceof SyntaxError) {
    return ctx.invalidate(error, {
      code: 'PROTOCOL',
      provider: providerId,
      raw: {
        kind: 'unexpected_response_format',
        message: `${provider} error: ${error.message}`,
      },
    });
  }

  if (error instanceof Error) {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider: providerId,
      raw: {
        kind: 'unknown_error',
        message: `${provider} error: ${error.message}`,
      },
    });
  }

  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider: providerId,
    raw: {
      kind: 'unknown_error',
      message: `${provider} error: Unknown error`,
    },
  });
}

/**
 * Map a provider error and throw it as a catchable RuntimeHaltSignal.
 * Use at the boundary of a host function call when a thrown halt is
 * preferable to a returned invalid value (e.g., inside an async
 * generator, or to short-circuit an outer await chain).
 *
 * Scripts can recover via `guard #AUTH`, `guard #TIMEOUT`, etc.
 */
export function throwProviderHalt(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
  detect: ProviderErrorDetector
): never {
  const invalid = mapProviderError(ctx, provider, error, detect);
  throw new RuntimeHaltSignal(invalid, true);
}
