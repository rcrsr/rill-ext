/**
 * Error detection and mapping for Azure AI Foundry extension.
 *
 * Mappers throw `RuntimeHaltSignal` carrying an invalid `RillValue` whose
 * status code is a generic atom (`#AUTH`, `#RATE_LIMIT`, ...). Host scripts
 * recover via `guard #ATOM`. Mappers are `never`-typed so the caller's
 * control flow ends at the throw.
 */

import { RuntimeHaltSignal, type RuntimeContext } from '@rcrsr/rill';
import type { ProviderErrorDetector } from '@rcrsr/rill-ext-llm-shared';
import OpenAI from 'openai';

// ============================================================
// CONSTANTS
// ============================================================

const PROVIDER = 'foundry';

// ============================================================
// PROVIDER ERROR DETECTOR
// ============================================================

/**
 * Foundry-specific error detector for mapProviderError.
 * Extracts HTTP status and message from OpenAI.APIError instances thrown by AzureOpenAI.
 *
 * Covers EC-12 (401), EC-13 (429), EC-14 (timeout), EC-15 (model not deployed).
 *
 * @param error - Error to inspect
 * @returns Status and message if a known provider error, null otherwise
 */
export const detectFoundryError: ProviderErrorDetector = (error: unknown) => {
  // AzureOpenAI uses the same OpenAI.APIError shape
  if (error instanceof OpenAI.APIError) {
    return {
      status: error.status ?? undefined,
      message: error.message,
    };
  }
  return null;
};

// ============================================================
// REST ERROR MAPPER
// ============================================================

/**
 * Map an HTTP response status to a generic atom and throw an invalid-value halt.
 * Used by REST clients that call Content Safety, AI Search, and Bing Grounding directly.
 *
 * Status → atom mapping:
 *   401 → #AUTH, 402 → #QUOTA_EXCEEDED, 403 → #FORBIDDEN, 404 → #NOT_FOUND,
 *   408 → #TIMEOUT, 429 → #RATE_LIMIT, 5xx → #UNAVAILABLE, other → #PROTOCOL.
 */
export function mapRestError(
  ctx: RuntimeContext,
  status: number,
  body?: unknown
): never {
  const code = restStatusToAtom(status);
  const detail = extractBodyMessage(body);
  const message =
    code === 'AUTH'
      ? `${PROVIDER}: authentication failed (401)`
      : code === 'RATE_LIMIT'
        ? `${PROVIDER}: rate limit exceeded`
        : `${PROVIDER}: ${detail ?? `HTTP ${status}`}`;
  throw new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code,
      provider: PROVIDER,
      raw: { kind: 'rest_error', status, message },
    }),
    true
  );
}

function restStatusToAtom(status: number): string {
  if (status === 401) return 'AUTH';
  if (status === 402) return 'QUOTA_EXCEEDED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'UNAVAILABLE';
  return 'PROTOCOL';
}

function extractBodyMessage(body: unknown): string | null {
  if (
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: { message?: unknown } }).error !== null &&
    typeof (body as { error: { message?: unknown } }).error?.message ===
      'string'
  ) {
    return (body as { error: { message: string } }).error.message;
  }
  return null;
}

// ============================================================
// TIMEOUT ERROR
// ============================================================

/**
 * Throw a `#TIMEOUT` halt for a request timeout (EC-14).
 */
export function createTimeoutError(ctx: RuntimeContext): never {
  const message = `${PROVIDER}: request timeout`;
  throw new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_timeout', message },
    }),
    true
  );
}

// ============================================================
// MODEL NOT DEPLOYED ERROR
// ============================================================

/**
 * Throw a `#NOT_FOUND` halt for an unknown deployment name (EC-15).
 */
export function createModelNotDeployedError(
  ctx: RuntimeContext,
  name: string
): never {
  const message = `${PROVIDER}: model '${name}' not deployed`;
  throw new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: { kind: 'model_not_deployed', model: name, message },
    }),
    true
  );
}

// ============================================================
// VARIABLE RESOLVER
// ============================================================

/**
 * Resolve `@{VAR}` references in a string using the provided lookup function.
 * Throws `#INVALID_INPUT` for any reference that the lookup cannot resolve.
 */
export function resolveVariables(
  ctx: RuntimeContext,
  input: string,
  lookup: (name: string) => string | undefined
): string {
  return input.replace(/@\{([^}]+)\}/g, (_match, varName: string) => {
    const value = lookup(varName);
    if (value === undefined) {
      const message = `${PROVIDER}: unresolved variable '${varName}'`;
      throw new RuntimeHaltSignal(
        ctx.invalidate(new Error(message), {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'unresolved_variable', variable: varName, message },
        }),
        true
      );
    }
    return value;
  });
}
