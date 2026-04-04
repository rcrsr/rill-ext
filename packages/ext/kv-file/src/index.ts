/**
 * @rcrsr/rill-ext-kv-file
 *
 * File-based key-value storage extension for rill scripting language.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createFileKvExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE EXPORTS
// ============================================================

export type {
  KvFileExtensionConfig,
  KvFileMountConfig,
  SchemaEntry,
} from './types.js';
export { createFileKvExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  store: { type: 'string' },
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
