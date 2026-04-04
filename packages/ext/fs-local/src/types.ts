/**
 * Type definitions for the local filesystem extension.
 *
 * @module
 */

// ============================================================
// MOUNT CONFIGURATION
// ============================================================

/** Mount configuration defining sandbox boundaries */
export interface MountConfig {
  /** Absolute or relative path on host filesystem */
  readonly path: string;
  /** Access mode for this mount */
  readonly mode: 'read' | 'write' | 'read-write';
  /** Optional file pattern filter (simple glob) */
  readonly glob?: string | undefined;
  /** Override file size limit per-mount (bytes) */
  readonly maxFileSize?: number | undefined;
  /** Resolved canonical path (set during mount initialization) */
  resolvedPath?: string | undefined;
}

// ============================================================
// EXTENSION CONFIGURATION
// ============================================================

/** Configuration for local filesystem extension factory */
export interface FsLocalExtensionConfig {
  /** Mount definitions keyed by mount name */
  readonly mounts: Record<string, MountConfig>;
  /** Global file size limit in bytes (default: 10485760 = 10MB) */
  readonly maxFileSize?: number | undefined;
  /** Text encoding for file operations (default: 'utf-8') */
  readonly encoding?: 'utf-8' | 'utf8' | 'ascii' | undefined;
}
