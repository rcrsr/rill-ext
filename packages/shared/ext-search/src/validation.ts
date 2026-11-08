/**
 * Configuration validation utilities for search extensions.
 * Validates required fields with type-safe assertions.
 */

import type { RuntimeContext } from '@rcrsr/rill';

/**
 * Validate that a configuration field is present and non-empty.
 *
 * Throws Error for undefined, null, or empty string.
 * Zero (0) passes validation as it is a valid value.
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error message
 * @throws Error when value is undefined, null, or empty string
 *
 * @example
 * ```typescript
 * assertRequired(config.apiKey, "apiKey");
 * assertRequired(0, "timeout"); // passes (zero is valid)
 * ```
 */
export function assertRequired<T>(
  value: T | undefined | null,
  fieldName: string
): asserts value is T {
  // undefined throws
  if (value === undefined) {
    throw new Error(`${fieldName} is required`);
  }

  // null throws
  if (value === null) {
    throw new Error(`${fieldName} is required`);
  }

  // empty string throws
  if (value === '') {
    throw new Error(`${fieldName} is required`);
  }
}

/**
 * Validate that a base URL begins with http:// or https://.
 *
 * @param url - URL string to validate
 * @throws Error when URL does not start with http:// or https://
 *
 * @example
 * ```typescript
 * validateBaseUrl("https://my-search.example.com"); // passes
 * validateBaseUrl("ftp://bad.example.com");         // throws
 * ```
 */
export function validateBaseUrl(url: string): void {
  // URL must start with http:// or https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('baseUrl must start with http:// or https://');
  }
}

/**
 * Copy scalar options into URL query params, in the given key order.
 *
 * Undefined values are skipped. Strings are set as-is; numbers and booleans
 * go through String(). Any other value throws an invalid
 * `invalid_option_type` value before any request is made.
 *
 * @param ctx - Runtime context used to build the invalid value
 * @param provider - Provider name for error metadata
 * @param params - Query params to append to
 * @param options - Caller-supplied options
 * @param keys - Option keys to copy, in order
 * @throws Invalid RillValue (INVALID_INPUT) when an option is not a scalar
 */
export function appendQueryOptions(
  ctx: RuntimeContext,
  provider: string,
  params: URLSearchParams,
  options: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): void {
  for (const key of keys) {
    const value = options[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      params.set(key, value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    } else {
      const message = `${provider}: option '${key}' must be a string, number, or boolean`;
      throw ctx.invalidate(new Error(message), {
        code: 'INVALID_INPUT',
        provider,
        raw: { kind: 'invalid_option_type', option: key, message },
      });
    }
  }
}
