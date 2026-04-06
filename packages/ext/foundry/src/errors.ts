/**
 * Error detection and mapping for Azure AI Foundry extension.
 * Converts HTTP errors and vendor SDK errors to RuntimeError with spec-defined messages.
 */

import { RuntimeError } from '@rcrsr/rill';
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
 * Map an HTTP response status to a RuntimeError with a spec-defined message (EC-12, EC-13).
 * Used by REST clients that call Content Safety, AI Search, and Bing Grounding directly.
 *
 * @param status - HTTP response status code
 * @param body - Optional parsed response body for additional context
 * @returns RuntimeError with spec-defined message
 */
export function mapRestError(status: number, body?: unknown): RuntimeError {
  if (status === 401) {
    return new RuntimeError('RILL-R004', `${PROVIDER}: authentication failed (401)`);
  }
  if (status === 429) {
    return new RuntimeError('RILL-R004', `${PROVIDER}: rate limit exceeded`);
  }

  const message =
    body !== null &&
    typeof body === 'object' &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: { message?: unknown } }).error !== null &&
    typeof (body as { error: { message?: unknown } }).error?.message === 'string'
      ? (body as { error: { message: string } }).error.message
      : `HTTP ${status}`;

  return new RuntimeError('RILL-R004', `${PROVIDER}: ${message}`);
}

// ============================================================
// TIMEOUT ERROR
// ============================================================

/**
 * Create a RuntimeError for request timeout (EC-14).
 *
 * @returns RuntimeError with spec-defined timeout message
 */
export function createTimeoutError(): RuntimeError {
  return new RuntimeError('RILL-R004', `${PROVIDER}: request timeout`);
}

// ============================================================
// MODEL NOT DEPLOYED ERROR
// ============================================================

/**
 * Create a RuntimeError for model not deployed (EC-15).
 *
 * @param name - Deployment name that was not found
 * @returns RuntimeError with spec-defined message
 */
export function createModelNotDeployedError(name: string): RuntimeError {
  return new RuntimeError('RILL-R004', `${PROVIDER}: model '${name}' not deployed`);
}

// ============================================================
// VARIABLE RESOLVER
// ============================================================

/**
 * Resolve `@{VAR}` references in a string using the provided lookup function.
 * Throws EC-17 for any reference that the lookup cannot resolve.
 *
 * @param input - String that may contain `@{VAR}` patterns
 * @param lookup - Function that returns the value for a variable name, or undefined if unknown
 * @returns String with all `@{VAR}` references replaced
 * @throws RuntimeError (RILL-R004) for each unresolved reference
 */
export function resolveVariables(
  input: string,
  lookup: (name: string) => string | undefined
): string {
  return input.replace(/@\{([^}]+)\}/g, (_match, varName: string) => {
    const value = lookup(varName);
    if (value === undefined) {
      throw new RuntimeError(
        'RILL-R004',
        `${PROVIDER}: unresolved variable '${varName}'`
      );
    }
    return value;
  });
}
