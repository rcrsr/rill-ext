/**
 * @rcrsr/rill-ext-claude-code
 *
 * Extension for executing Claude Code toolkit operations from rill scripts.
 */

import { createRequire } from 'node:module';

// ============================================================
// VERSION
// ============================================================

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type {
  TokenCounts,
  TokenUsage,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  SystemMessage,
  AssistantMessage,
  UserMessage,
  ResultMessage,
  ClaudeMessage,
  ClaudeCodeConfig,
  PromptOptions,
  ClaudeCodeResult,
} from './types.js';

// ============================================================
// STREAM PARSER
// ============================================================

export type { StreamParser } from './stream-parser.js';
export { createStreamParser } from './stream-parser.js';

// ============================================================
// RESULT EXTRACTION
// ============================================================

export { extractResult } from './result.js';

// ============================================================
// PROCESS MANAGER
// ============================================================

export type { SpawnResult, SpawnOptions } from './process.js';
export { spawnClaudeCli } from './process.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createClaudeCodeExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createClaudeCodeExtension as _factory } from './factory.js';

export const configSchema: ExtensionConfigSchema = {
  binaryPath: { type: 'string' },
  defaultTimeout: { type: 'number' },
  dangerouslySkipPermissions: { type: 'boolean' },
  settingSources: { type: 'string' },
};

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
