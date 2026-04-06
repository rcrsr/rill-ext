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
 * The rill ExtensionConfigSchema type supports only flat string/number/boolean
 * fields. Nested auth and capabilities fields are documented here as strings;
 * the factory validates the full structure at runtime.
 *
 * Leaf-level fields:
 *   auth.type    — 'bearer' or 'session' (required)
 *   auth.token   — Bearer token (required when auth.type = 'bearer')
 *   auth.tokenVar — RuntimeContext variable name (required when auth.type = 'session')
 *   mailbox      — Shared mailbox UPN/ID (optional, uses /me/ when absent)
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
