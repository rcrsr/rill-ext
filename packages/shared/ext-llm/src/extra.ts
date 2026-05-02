/**
 * Reserved key validation for LLM provider `extra` config
 *
 * Provides factory-time helpers for validating that user-supplied `extra`
 * fields do not collide with keys the LLM provider owns internally.
 */

import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// RESERVED KEYS
// ============================================================

/**
 * Keys that LLM provider implementations manage internally.
 * These must not appear in the user-supplied `extra` dict.
 *
 * Order matches the spec (IR-11).
 */
export const RESERVED_KEYS_COMMON = [
  'messages',
  'model',
  'system',
  'temperature',
  'max_tokens',
  'stream',
  'response_format',
] as const;

// ============================================================
// EXTRA KEYS VALIDATION
// ============================================================

/**
 * Validates that `extra` does not contain any reserved keys.
 *
 * Pure function; idempotent. Called at factory init before client creation.
 *
 * @param extra - User-supplied extra config dict (or undefined)
 * @param reservedKeys - Keys the provider owns; collisions are rejected
 * @throws RuntimeError('RILL-R001', ...) per EC-19 and EC-20
 */
export function validateExtraKeys(
  extra: unknown,
  reservedKeys: ReadonlyArray<string>
): void {
  // Undefined means the user did not supply extra; nothing to validate.
  if (extra === undefined) {
    return;
  }

  // EC-20: extra is not a plain object (null, array, primitive, etc.)
  if (
    typeof extra !== 'object' ||
    extra === null ||
    Array.isArray(extra)
  ) {
    throw new RuntimeError(
      'RILL-R001',
      "Factory config 'extra' must be a dict."
    );
  }

  // EC-19: extra contains one or more reserved keys
  const extraKeys = Object.keys(extra as Record<string, unknown>);
  const reservedSet = new Set(reservedKeys);
  const colliding = extraKeys
    .filter((k) => reservedSet.has(k))
    .sort();

  if (colliding.length > 0) {
    const keyList = colliding.map((k) => `'${k}'`).join(', ');
    throw new RuntimeError(
      'RILL-R001',
      `Factory config 'extra' contains reserved key(s): ${keyList}. These keys are managed by the provider and must not be overridden via 'extra'.`
    );
  }
}

// ============================================================
// MAX_TURNS VALIDATION
// ============================================================

/**
 * Validates the factory-level `max_turns` config value.
 *
 * Called at factory init. Undefined is allowed (no factory-level cap).
 * Zero is rejected because it is a reserved sentinel for per-call override
 * semantics. Negative values and non-integers are also rejected.
 *
 * @param value - The max_turns config value (or undefined)
 * @throws RuntimeError('RILL-R001', ...) per EC-21 and EC-22
 */
export function validateMaxTurns(value: unknown): void {
  if (value === undefined) {
    return;
  }

  // EC-21: sentinel value 0 is reserved
  if (value === 0) {
    throw new RuntimeError(
      'RILL-R001',
      "Factory config 'max_turns' must be a positive integer or undefined; sentinel value 0 is reserved for per-call override semantics."
    );
  }

  // EC-22: negative or non-integer
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new RuntimeError(
      'RILL-R001',
      "Factory config 'max_turns' must be a positive integer or undefined."
    );
  }
}

// ============================================================
// MAX_ERRORS VALIDATION
// ============================================================

/**
 * Validates the factory-level `max_errors` config value.
 *
 * Called at factory init. Undefined is allowed (default 3 applies). Zero,
 * negative values, and non-integers are rejected so a misconfigured extension
 * fails fast instead of silently falling back to the default.
 *
 * @param value - The max_errors config value (or undefined)
 * @throws RuntimeError('RILL-R001', ...) when value is not a positive integer
 */
export function validateMaxErrors(value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new RuntimeError(
      'RILL-R001',
      "Factory config 'max_errors' must be a positive integer or undefined."
    );
  }
}
