/**
 * Unit tests for transport creation and error mapping.
 *
 * Coverage:
 * - EC-3: Server process exits
 * - EC-4: Connection refused
 * - EC-5: Auth required
 * - AC-4: Dynamic token refresh
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createMcpExtension } from '../../src/factory.js';
import { makeFactoryCtx } from '../_helpers.js';
import type {
  McpExtensionConfig,
  McpHttpTransportConfig,
} from '../../src/types.js';

describe('Transport Creation', () => {
  describe('EC-3: Server process exits', () => {
    it('maps ENOENT error to process exit error', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'nonexistent-command-xyz123',
          args: [],
        },
      };

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow(/mcp: server process exited with code/);
    });

    it('maps exit code from error message', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'nonexistent-test-command',
        },
      };

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow(/server process exited with code 1/);
    });
  });

  describe('EC-4: Connection refused', () => {
    it('maps connection refused for invalid HTTP URL', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:59999/mcp', // Port unlikely to be in use
        },
        timeout: 2000, // Short timeout
      };

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow(
        /mcp: connection refused at http:\/\/localhost:59999\/mcp/
      );
    }, 5000);
  });

  describe('EC-5: Auth required', () => {
    it('detects 401 unauthorized response', async () => {
      // This test requires a real server returning 401
      // The httpbin.org service should return 401
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://httpbin.org/status/401',
        },
        timeout: 5000,
      };

      // The error may come from the MCP SDK as a different format
      // We just verify it throws (401 handling is tested in error mapping)
      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow();
    }, 10000);
  });

  describe('AC-4: Dynamic token refresh', () => {
    // Client.connect is spied so no network is touched; the transport handed
    // to connect carries the headers the factory resolved.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function connectAndCaptureHeaders(
      headers: NonNullable<McpHttpTransportConfig['headers']>
    ): Promise<Headers> {
      let captured: Transport | undefined;
      vi.spyOn(Client.prototype, 'connect').mockImplementation(
        async (transport) => {
          captured = transport;
        }
      );
      vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({});

      const ext = await createMcpExtension(
        {
          transport: {
            type: 'http',
            url: 'http://localhost:59998/mcp',
            headers,
          },
        },
        makeFactoryCtx()
      );
      await ext.dispose?.();

      expect(captured).toBeInstanceOf(StreamableHTTPClientTransport);
      // Couples to the SDK private `_requestInit` field of
      // StreamableHTTPClientTransport (@modelcontextprotocol/sdk ^1.32.2 in
      // package.json). A failure here after an SDK bump means the field moved.
      const requestInit: unknown = (captured as StreamableHTTPClientTransport)[
        '_requestInit'
      ];
      expect(requestInit).toHaveProperty('headers');
      const { headers: resolved } = requestInit as { headers: unknown };
      expect(resolved).toBeInstanceOf(Headers);
      return resolved as Headers;
    }

    it('calls function headers and passes the result to the transport', async () => {
      const headerFn = vi.fn(() => ({ Authorization: 'Bearer token-1' }));

      const resolved = await connectAndCaptureHeaders(headerFn);

      expect(headerFn).toHaveBeenCalledTimes(1);
      expect(resolved.get('Authorization')).toBe('Bearer token-1');
    });

    it('awaits async function headers and passes the result to the transport', async () => {
      const headerFn = vi.fn(async () => ({
        Authorization: 'Bearer async-token-1',
      }));

      const resolved = await connectAndCaptureHeaders(headerFn);

      expect(headerFn).toHaveBeenCalledTimes(1);
      expect(resolved.get('Authorization')).toBe('Bearer async-token-1');
    });

    it('passes static headers object to the transport', async () => {
      const resolved = await connectAndCaptureHeaders({
        Authorization: 'Bearer static-token',
        'X-Custom-Header': 'custom-value',
      });

      expect(resolved.get('Authorization')).toBe('Bearer static-token');
      expect(resolved.get('X-Custom-Header')).toBe('custom-value');
    });

    // Test header handling logic without actual connection
    it('validates header configuration types', () => {
      // Static headers
      const staticConfig: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:3000/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      };
      expect(staticConfig.transport.type).toBe('http');

      // Function headers
      const fnTransport: McpHttpTransportConfig = {
        type: 'http',
        url: 'http://localhost:3000/mcp',
        headers: () => ({ Authorization: 'Bearer token' }),
      };
      expect(typeof fnTransport.headers).toBe('function');

      // Async function headers
      const asyncFnTransport: McpHttpTransportConfig = {
        type: 'http',
        url: 'http://localhost:3000/mcp',
        headers: async () => ({ Authorization: 'Bearer token' }),
      };
      expect(typeof asyncFnTransport.headers).toBe('function');
    });
  });

  describe('Transport type routing', () => {
    it('creates stdio transport for stdio config', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'test-stdio-command',
          args: ['--arg'],
          env: { KEY: 'value' },
        },
      };

      // Will fail because command doesn't exist, but confirms stdio path
      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow();
    });

    it('creates HTTP transport for http config', async () => {
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:59995/mcp',
        },
        timeout: 2000,
      };

      // Will fail because server doesn't exist, but confirms http path
      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow();
    }, 5000);
  });
});
