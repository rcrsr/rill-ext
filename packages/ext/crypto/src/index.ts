/**
 * @rcrsr/rill-ext-crypto
 *
 * Cryptographic operations extension for rill scripting language.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createCryptoExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE EXPORTS
// ============================================================

export type { CryptoExtensionConfig } from './types.js';
export { createCryptoExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  defaultAlgorithm: { type: 'string' },
  hmacKey: { type: 'string', secret: true },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
