/**
 * @rcrsr/rill-ext-prompt-md
 *
 * Markdown prompt loader extension for the rill scripting language.
 * Scans a directory for *.prompt.md files and exposes each as a
 * named callable in the extension value dict.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema } from '@rcrsr/rill';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE EXPORTS
// ============================================================

export type { PromptMdExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================

export { createPromptMdExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  basePath: { type: 'string' },
};
