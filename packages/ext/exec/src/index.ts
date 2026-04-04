/**
 * @rcrsr/rill-ext-exec
 *
 * Sandboxed command execution extension for rill scripting language.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createExecExtension as _factory } from './factory.js';

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
  ExecExtensionConfig,
  CommandConfig,
  CommandResult,
} from './types.js';
export { createExecExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  commands: { type: 'string', required: true },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
