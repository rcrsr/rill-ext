/**
 * Configuration validation utilities for search extensions.
 * Validates required fields with type-safe assertions.
 */

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
