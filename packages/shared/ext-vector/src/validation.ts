/**
 * Configuration validation utilities for vector database extensions.
 * Validates required fields with type-safe assertions.
 */

import { RuntimeError } from '@rcrsr/rill';

/**
 * Validate that a configuration field is present and non-empty.
 *
 * Throws RuntimeError('RILL-R001') for undefined, null, or empty string.
 * Zero (0) passes validation as it is a valid value.
 *
 * @param value - Value to validate
 * @param fieldName - Field name for error message
 * @throws RuntimeError('RILL-R001') when value is undefined, null, or empty string
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
    throw new RuntimeError('RILL-R001', `${fieldName} is required`);
  }

  // null throws
  if (value === null) {
    throw new RuntimeError('RILL-R001', `${fieldName} is required`);
  }

  // empty string throws
  if (value === '') {
    throw new RuntimeError('RILL-R001', `${fieldName} is required`);
  }

  // Zero (0) passes validation
  // Non-empty string passes validation
}
