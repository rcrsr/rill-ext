/**
 * Type definitions for kv-file extension.
 *
 * @module
 */

import type { RillValue } from '@rcrsr/rill';

/** Schema entry defining type and default for a key. */
export interface SchemaEntry {
  readonly type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  readonly default: RillValue;
  readonly description?: string | undefined;
}

/** Configuration for a single KV mount. */
export interface KvFileMountConfig {
  /** Access mode */
  readonly mode: 'read' | 'write' | 'read-write';
  /** Schema definitions (optional, enables declared mode) */
  readonly schema?: Record<string, SchemaEntry> | undefined;
  /** Path to store file */
  readonly store: string;
  /** Maximum entries (default: 10000) */
  readonly maxEntries?: number | undefined;
  /** Maximum value size in bytes (default: 102400 = 100KB) */
  readonly maxValueSize?: number | undefined;
  /** Maximum store size in bytes (default: 10485760 = 10MB) */
  readonly maxStoreSize?: number | undefined;
  /** Write policy: 'dispose' (default) or 'immediate' */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
}

/** KV file extension configuration (supports both single-store and multi-mount). */
export interface KvFileExtensionConfig {
  /** Mount definitions keyed by mount name */
  readonly mounts?: Record<string, KvFileMountConfig> | undefined;
  /** Path to store file (legacy single-store config) */
  readonly store?: string | undefined;
  /** Schema definitions (legacy, for single-store mode) */
  readonly schema?: Record<string, SchemaEntry> | undefined;
  /** Maximum entries (legacy, default: 10000) */
  readonly maxEntries?: number | undefined;
  /** Maximum value size in bytes (legacy, default: 102400 = 100KB) */
  readonly maxValueSize?: number | undefined;
  /** Maximum store size in bytes (legacy, default: 10485760 = 10MB) */
  readonly maxStoreSize?: number | undefined;
  /** Write policy (legacy): 'dispose' (default) or 'immediate' */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
  /** Access mode (legacy): 'read', 'write', or 'read-write' (default: 'read-write') */
  readonly mode?: 'read' | 'write' | 'read-write' | undefined;
}
