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
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('maps a 401 connect failure to the auth-required error', async () => {
      vi.spyOn(Client.prototype, 'connect').mockRejectedValue(
        new Error('HTTP 401 Unauthorized')
      );
      const config: McpExtensionConfig = {
        transport: {
          type: 'http',
          url: 'http://localhost:59997/mcp',
        },
      };

      await expect(
        createMcpExtension(config, makeFactoryCtx())
      ).rejects.toThrow(
        /server requires authentication -- complete OAuth flow before connecting/
      );
    });
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
      vi.spyOn(Client.prototype, 'connect').mockImplementation((transport) => {
        captured = transport;
        return Promise.resolve();
      });
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
      const headerFn = vi.fn(() =>
        Promise.resolve({
          Authorization: 'Bearer async-token-1',
        })
      );

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
  });
});
