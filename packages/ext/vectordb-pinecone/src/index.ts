import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createPineconeExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// CONFIGURATION
// ============================================================
export type { PineconeConfig, PineconeExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createPineconeExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  apiKey: { type: 'string', required: true, secret: true },
  index: { type: 'string', required: true },
  namespace: { type: 'string' },
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
