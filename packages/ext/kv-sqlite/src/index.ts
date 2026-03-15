/**
 * SQLite kv extension for rill.
 * Provides key-value storage operations using SQLite backend.
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createSqliteKvExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  SqliteKvConfig,
  SqliteKvMountConfig,
  SchemaEntry,
} from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createSqliteKvExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  mounts: { type: 'string' },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
