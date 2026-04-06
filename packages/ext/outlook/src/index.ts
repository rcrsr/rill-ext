import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createOutlookExtension as _factory } from './factory.js';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// CONFIGURATION
// ============================================================

export type { OutlookConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================

export { createOutlookExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

/**
 * Config schema for Outlook extension.
 * Only flat fields are representable in ExtensionConfigSchema.
 * Auth and capabilities are validated at runtime by the factory.
 */
export const configSchema: ExtensionConfigSchema = {
  mailbox: { type: 'string' },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
