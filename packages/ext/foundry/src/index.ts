/**
 * @rcrsr/rill-ext-foundry
 *
 * Extension for Azure AI Foundry integration with rill scripts.
 * Provides LLM inference, content safety, Bing grounding, and AI Search.
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  endpoint: { type: 'string', required: true },
  // auth fields — nested objects use string type for schema purposes
  auth_type: { type: 'string', required: true },
  auth_key: { type: 'string', secret: true },
};

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type {
  FoundryConfig,
  FoundryAuth,
  FoundryApiKeyAuth,
  FoundryEntraAuth,
  FoundryInferenceConfig,
  FoundryContentSafetyConfig,
  FoundryGroundingConfig,
  FoundrySearchConfig,
} from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createFoundryExtension } from './factory.js';

// ============================================================
// EXTENSION MANIFEST
// ============================================================

import { createFoundryExtension as _factory } from './factory.js';

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
