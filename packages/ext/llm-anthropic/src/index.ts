/**
 * @rcrsr/rill-ext-anthropic
 *
 * Extension for Anthropic Claude API integration with rill scripts.
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
  api_key: { type: 'string', required: true, secret: true },
  model: { type: 'string', required: true },
  base_url: { type: 'string' },
  temperature: { type: 'number' },
  max_tokens: { type: 'number' },
  timeout: { type: 'number' },
  max_retries: { type: 'number' },
  system: { type: 'string' },
  embed_model: { type: 'string' },
};

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMProviderConfig as LLMExtensionConfig } from '@rcrsr/rill-ext-llm-shared';
export type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createAnthropicExtension } from './factory.js';

// ============================================================
// EXTENSION MANIFEST
// ============================================================

import { createAnthropicExtension as _factory } from './factory.js';

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
