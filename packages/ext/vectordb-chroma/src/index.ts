/**
 * ChromaDB extension for rill.
 * Provides vector database operations using ChromaDB.
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createChromaExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// PUBLIC TYPES
// ============================================================
export type { ChromaConfig, ChromaExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createChromaExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  url: { type: 'string' },
  collection: { type: 'string', required: true },
  embeddingFunction: { type: 'string' },
  timeout: { type: 'number' },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
