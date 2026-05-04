import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createGoogleWorkspaceExtension as _factory } from './factory.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type {
  GoogleAuth,
  GoogleAuthBearer,
  GoogleAuthSession,
  GoogleAuthServiceAccount,
  GmailCapabilities,
  DriveCapabilities,
  CalendarCapabilities,
  GoogleCapabilities,
  GmailConfig,
  DriveConfig,
  CalendarConfig,
  GoogleWorkspaceConfig,
  ServiceAccountKey,
  GoogleWorkspaceExtensionContract,
  ExtensionFactoryResult,
} from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createGoogleWorkspaceExtension } from './factory.js';

// ============================================================
// UTILITIES
// ============================================================

export {
  validateConfig,
  mergeCapabilities,
  parseServiceAccountKey,
} from './config.js';

export { checkCapability } from './capabilities.js';
export { mapGoogleError, mapFetchError } from './errors.js';

// ============================================================
// CONFIG SCHEMA  [§EXT.2.2]
// ============================================================

/**
 * Config schema for Google Workspace extension.
 *
 * Intentionally empty: GoogleWorkspaceConfig has no flat top-level primitive
 * fields. Every field (auth, capabilities, gmail, drive, calendar) is a
 * nested object or discriminated union. ExtensionConfigSchema in the current
 * @rcrsr/rill core does not represent nested objects or discriminated
 * unions, so the full config is validated at runtime by the factory via
 * validateConfig() in src/config.ts.
 *
 * Blocked-on: rill core support for nested types in ExtensionConfigSchema.
 */
export const configSchema: ExtensionConfigSchema = {};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

/**
 * Manifest consumed by `rill-run` and other config-driven hosts.
 * `rill-run` mounts the extension at the configured path and passes the
 * `extensions.config[mount]` object to the factory.
 */
export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
