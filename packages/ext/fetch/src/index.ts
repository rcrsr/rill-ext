/**
 * @rcrsr/rill-ext-fetch
 *
 * HTTP fetch extension for rill scripting language.
 * Provides typed endpoint functions with retry, concurrency control,
 * and timeout enforcement.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createFetchExtension as _factory } from './factory.js';

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
  FetchExtensionConfig,
  EndpointConfig,
  EndpointParam,
} from './types.js';

// ============================================================
// FACTORY EXPORT
// ============================================================

export { createFetchExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  endpoints: { type: 'string', required: true },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
