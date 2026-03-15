/**
 * @rcrsr/rill-ext-mcp
 *
 * rill extension for Model Context Protocol (MCP) integration.
 *
 * This extension provides host functions for connecting to MCP servers,
 * calling tools, accessing resources, and managing MCP client sessions.
 */

// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  McpExtensionConfig,
  McpTransportConfig,
  McpStdioTransportConfig,
  McpHttpTransportConfig,
} from './types.js';

// ============================================================
// FACTORY FUNCTIONS
// ============================================================
export { createMcpExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

import { createRequire } from 'node:module';
import type { ExtensionConfigSchema, ExtensionManifest } from '@rcrsr/rill';
import { createMcpExtension as _factory } from './factory.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };
export const VERSION = _pkg.version;

export const configSchema: ExtensionConfigSchema = {
  timeout: { type: 'number' },
};

// ============================================================
// ERROR UTILITIES
// ============================================================
export {
  createFactoryError,
  createConnectionError,
  createProcessExitError,
  createConnectionRefusedError,
  createAuthRequiredError,
  createRuntimeError,
  createToolError,
  createProtocolError,
  createTimeoutError,
  createConnectionLostError,
  createAuthFailedError,
} from './errors.js';

// ============================================================
// EXTENSION MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: _factory,
  configSchema,
  version: VERSION,
};
