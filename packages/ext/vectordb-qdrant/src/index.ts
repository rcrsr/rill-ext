import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createQdrantExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// CONFIGURATION
// ============================================================
export type { QdrantConfig, QdrantExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createQdrantExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  url: { type: 'string', required: true },
  apiKey: { type: 'string', secret: true },
  collection: { type: 'string', required: true },
  dimensions: { type: 'number' },
  distance: { type: 'string' },
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
