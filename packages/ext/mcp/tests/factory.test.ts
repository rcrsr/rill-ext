/**
 * Tests for MCP extension factory config validation.
 */

import { describe, it, expect } from 'vitest';
import { createMcpExtension } from '../src/factory.js';
import type { McpExtensionConfig } from '../src/types.js';
import { makeFactoryCtx } from './_helpers.js';

describe('createMcpExtension', () => {
  describe('missing stdio command', () => {
    it.each<{ title: string; command: unknown }>([
      { title: 'throws for empty stdio command', command: '' },
      { title: 'throws for undefined stdio command', command: undefined },
      { title: 'throws for null stdio command', command: null },
    ])('$title', async ({ command }) => {
      const config = {
        transport: { type: 'stdio', command },
      } as unknown as McpExtensionConfig;

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow('transport.command is required for stdio transport');
    });
  });

  describe('missing http url', () => {
    it.each<{ title: string; url: unknown }>([
      { title: 'throws for empty http url', url: '' },
      { title: 'throws for undefined http url', url: undefined },
      { title: 'throws for null http url', url: null },
    ])('$title', async ({ url }) => {
      const config = {
        transport: { type: 'http', url },
      } as unknown as McpExtensionConfig;

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow('transport.url is required for http transport');
    });
  });
});
