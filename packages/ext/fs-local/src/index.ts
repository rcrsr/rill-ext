/**
 * @rcrsr/rill-ext-fs-local
 *
 * Local filesystem extension for rill with mount-based sandboxing.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createLocalFsExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { FsLocalExtensionConfig, MountConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createLocalFsExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  mounts: { type: 'string', required: true },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
