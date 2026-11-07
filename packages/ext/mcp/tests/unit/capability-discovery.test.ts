/**
 * Unit tests for capability discovery.
 *
 * Coverage:
 * - IR-1: Parallel listTools, listResources, listPrompts
 * - BC-7: Filtered capabilities
 * - BC-7: Filtering verified through generated functions in value dict
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpExtensionConfig } from '../../src/types.js';
import { makeFactoryCtx } from '../_helpers.js';

// Mock the SDK transports to avoid actual process spawning
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioTransport {
    onerror: ((error: Error) => void) | undefined = undefined;
    start = vi.fn();
    close = vi.fn();
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockHTTPTransport {
    onerror: ((error: Error) => void) | undefined = undefined;
    start = vi.fn();
    close = vi.fn();
    constructor(_url: URL, _options?: unknown) {
      // Mock constructor
    }
  },
}));

// Import factory after mocks are set up
const { createMcpExtension } = await import('../../src/factory.js');

describe('Capability Discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // All tests assume server declares full capabilities
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
      resources: {},
      prompts: {},
    });
  });

  describe('IR-1: Parallel capability discovery', () => {
    it('starts listTools, listResources, listResourceTemplates, listPrompts before any resolves', async () => {
      const gates: Array<() => void> = [];
      const gated = <T>(value: T): Promise<T> =>
        new Promise<T>((resolve) => {
          gates.push(() => resolve(value));
        });
      const mockListTools = vi.fn(() =>
        gated({
          tools: [
            {
              name: 'tool1',
              description: 'Tool 1',
              inputSchema: { type: 'object' as const },
            },
            {
              name: 'tool2',
              description: 'Tool 2',
              inputSchema: { type: 'object' as const },
            },
          ],
        })
      );
      const mockListResources = vi.fn(() =>
        gated({
          resources: [
            {
              uri: 'file://resource1',
              name: 'Resource 1',
              description: 'Desc 1',
            },
          ],
        })
      );
      const mockListResourceTemplates = vi.fn(() =>
        gated({
          resourceTemplates: [
            {
              uriTemplate: 'file://{path}',
              name: 'Template 1',
              description: 'Template Desc 1',
            },
          ],
        })
      );
      const mockListPrompts = vi.fn(() =>
        gated({
          prompts: [
            { name: 'prompt1', description: 'Prompt 1', arguments: [] },
          ],
        })
      );

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockImplementation(mockListTools);
      vi.spyOn(Client.prototype, 'listResources').mockImplementation(
        mockListResources
      );
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockImplementation(
        mockListResourceTemplates
      );
      vi.spyOn(Client.prototype, 'listPrompts').mockImplementation(
        mockListPrompts
      );

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
      };

      const pending = createMcpExtension(config, makeFactoryCtx());

      // All four requests are in flight while none has resolved yet
      await vi.waitFor(() => {
        expect(gates).toHaveLength(4);
      });
      expect(mockListTools).toHaveBeenCalledTimes(1);
      expect(mockListResources).toHaveBeenCalledTimes(1);
      expect(mockListResourceTemplates).toHaveBeenCalledTimes(1);
      expect(mockListPrompts).toHaveBeenCalledTimes(1);

      for (const release of gates) release();
      const result = await pending;
      const fns = result.value as Record<string, unknown>;

      // Discovered capabilities reflected in namespaced dicts
      const toolsDict = fns['tools'] as Record<string, unknown>;
      const resourcesDict = fns['resources'] as Record<string, unknown>;
      const promptsDict = fns['prompts'] as Record<string, unknown>;

      expect(toolsDict['tool1']).toBeDefined();
      expect(toolsDict['tool2']).toBeDefined();
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(promptsDict['prompt1']).toBeDefined();
    });

    it('handles empty capability lists', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
      };

      const result = await createMcpExtension(config, makeFactoryCtx());
      const fns = result.value as Record<string, unknown>;

      // With empty capabilities, only introspection + read_resource functions exist
      const toolsDict = fns['tools'] as Record<string, unknown>;
      const resourcesDict = fns['resources'] as Record<string, unknown>;
      const promptsDict = fns['prompts'] as Record<string, unknown>;

      expect(Object.keys(toolsDict)).toHaveLength(0);
      // read_resource is always generated
      expect(Object.keys(resourcesDict)).toHaveLength(1);
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(Object.keys(promptsDict)).toHaveLength(0);
    });
  });

  describe('BC-7: Filtered capabilities', () => {
    it('empty filter includes all capabilities', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: { type: 'object' } },
          { name: 'tool2', inputSchema: { type: 'object' } },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [{ uri: 'file://resource1', name: 'Resource 1' }],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [{ name: 'prompt1' }],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        toolFilter: [], // Empty = all
        resourceFilter: [], // Empty = all
        promptFilter: [], // Empty = all
      };

      const result = await createMcpExtension(config, makeFactoryCtx());
      const fns = result.value as Record<string, unknown>;

      // All capabilities included when filter is empty
      const toolsDict = fns['tools'] as Record<string, unknown>;
      const resourcesDict = fns['resources'] as Record<string, unknown>;
      const promptsDict = fns['prompts'] as Record<string, unknown>;
      expect(toolsDict['tool1']).toBeDefined();
      expect(toolsDict['tool2']).toBeDefined();
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(promptsDict['prompt1']).toBeDefined();
    });
  });
});
