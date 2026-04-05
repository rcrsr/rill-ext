import type { ApplicationCallable } from '@rcrsr/rill';

/**
 * Contract type for kv extension implementations.
 * Enforces exact function structure for compile-time verification.
 *
 * Backend implementations must provide all 11 functions:
 * - get(mount, key): Retrieve a value
 * - get_or(mount, key, default): Retrieve with fallback
 * - set(mount, key, value): Store a value
 * - merge(mount, key, value): Deep merge into existing value
 * - delete(mount, key): Remove a key
 * - keys(mount): List all keys
 * - has(mount, key): Check key existence
 * - clear(mount): Remove all keys
 * - getAll(mount): Retrieve all key-value pairs
 * - schema(mount): Get mount schema metadata
 * - mounts(): List all configured mounts
 */
export type KvExtensionContract = {
  readonly get: ApplicationCallable;
  readonly get_or: ApplicationCallable;
  readonly set: ApplicationCallable;
  readonly merge: ApplicationCallable;
  readonly delete: ApplicationCallable;
  readonly keys: ApplicationCallable;
  readonly has: ApplicationCallable;
  readonly clear: ApplicationCallable;
  readonly getAll: ApplicationCallable;
  readonly schema: ApplicationCallable;
  readonly mounts: ApplicationCallable;
};
