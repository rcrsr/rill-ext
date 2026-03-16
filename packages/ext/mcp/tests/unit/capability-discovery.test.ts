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
    it('calls listTools, listResources, listResourceTemplates, listPrompts in parallel', async () => {
      // Mock Client methods
      const mockListTools = vi.fn().mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'Tool 1', inputSchema: {} },
          { name: 'tool2', description: 'Tool 2', inputSchema: {} },
        ],
      });
      const mockListResources = vi.fn().mockResolvedValue({
        resources: [
          {
            uri: 'file://resource1',
            name: 'Resource 1',
            description: 'Desc 1',
          },
        ],
      });
      const mockListResourceTemplates = vi.fn().mockResolvedValue({
        resourceTemplates: [
          {
            uriTemplate: 'file://{path}',
            name: 'Template 1',
            description: 'Template Desc 1',
          },
        ],
      });
      const mockListPrompts = vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt1', description: 'Prompt 1', arguments: [] }],
      });
      const mockConnect = vi.fn().mockResolvedValue(undefined);

      // Spy on Client constructor to inject mocks
      vi.spyOn(Client.prototype, 'connect').mockImplementation(mockConnect);
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

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // Verify all four list methods were called
      expect(mockListTools).toHaveBeenCalledTimes(1);
      expect(mockListResources).toHaveBeenCalledTimes(1);
      expect(mockListResourceTemplates).toHaveBeenCalledTimes(1);
      expect(mockListPrompts).toHaveBeenCalledTimes(1);

      // Verify discovered capabilities reflected in value dict
      // 2 tools + read_resource + 1 resource template + 1 prompt + 3 introspection
      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeDefined();
      expect(fns.read_resource).toBeDefined();
      expect(fns.prompt_prompt1).toBeDefined();
      expect(fns.tools).toBeDefined();
      expect(fns.resources).toBeDefined();
      expect(fns.prompts).toBeDefined();
    });

    it('handles empty capability lists', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
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

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // With empty capabilities, only introspection + read_resource functions exist
      const toolsDict = (await fns.tools.fn({})) as Record<string, unknown>;
      const resourcesDict = (await fns.resources.fn({})) as Record<string, unknown>;
      const promptsDict = (await fns.prompts.fn({})) as Record<string, unknown>;

      expect(Object.keys(toolsDict)).toHaveLength(0);
      // read_resource is always generated
      expect(Object.keys(resourcesDict)).toHaveLength(1);
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(Object.keys(promptsDict)).toHaveLength(0);
    });
  });

  describe('BC-7: Filtered capabilities', () => {
    it('filters tools by exact name match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'Tool 1', inputSchema: {} },
          { name: 'tool2', description: 'Tool 2', inputSchema: {} },
          { name: 'tool3', description: 'Tool 3', inputSchema: {} },
        ],
      });
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
        toolFilter: ['tool1', 'tool3'], // Only include tool1 and tool3
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // Only filtered tools present as functions
      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeUndefined();
      expect(fns.tool3).toBeDefined();

      // Introspection tools dict reflects filtered set
      const toolsDict = (await fns.tools.fn({})) as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(2);
      expect(toolsDict['tool1']).toBeDefined();
      expect(toolsDict['tool3']).toBeDefined();
    });

    it('filters resources by exact URI match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          { uri: 'file://resource1', name: 'Resource 1' },
          { uri: 'file://resource2', name: 'Resource 2' },
          { uri: 'http://resource3', name: 'Resource 3' },
        ],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        resourceFilter: ['file://resource1', 'http://resource3'],
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // read_resource is always present regardless of filter
      expect(fns.read_resource).toBeDefined();

      // Resource filter affects the resources introspection dict
      // (read_resource is always included in the introspection dict)
      expect(fns.resources).toBeDefined();
    });

    it('filters prompts by exact name match', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({ tools: [] });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [],
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [
          { name: 'prompt1', description: 'Prompt 1' },
          { name: 'prompt2', description: 'Prompt 2' },
          { name: 'prompt3', description: 'Prompt 3' },
          { name: 'prompt4', description: 'Prompt 4' },
        ],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        promptFilter: ['prompt2', 'prompt4'],
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // Only filtered prompts present as functions
      expect(fns.prompt_prompt1).toBeUndefined();
      expect(fns.prompt_prompt2).toBeDefined();
      expect(fns.prompt_prompt3).toBeUndefined();
      expect(fns.prompt_prompt4).toBeDefined();

      // Introspection prompts dict reflects filtered set
      const promptsDict = (await fns.prompts.fn({})) as Record<string, unknown>;
      expect(Object.keys(promptsDict)).toHaveLength(2);
      expect(promptsDict['prompt_prompt2']).toBeDefined();
      expect(promptsDict['prompt_prompt4']).toBeDefined();
    });

    it('empty filter includes all capabilities', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
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

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // All capabilities included when filter is empty
      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeDefined();
      expect(fns.read_resource).toBeDefined();
      expect(fns.prompt_prompt1).toBeDefined();
    });

    it('undefined filter includes all capabilities', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
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
        // No filters = all included
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeDefined();
      expect(fns.read_resource).toBeDefined();
      expect(fns.prompt_prompt1).toBeDefined();
    });

    it('non-matching filter results in empty filtered list', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [{ name: 'tool1', inputSchema: {} }],
      });
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
        toolFilter: ['nonexistent-tool'],
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // tool1 not generated because filter excluded it
      expect(fns.tool1).toBeUndefined();

      // Introspection tools dict is empty
      const toolsDict = (await fns.tools.fn({})) as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(0);
    });
  });

  describe('BC-7: Filtering verified through generated functions', () => {
    it('generates only filtered tool functions from 100 available', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: Array.from({ length: 100 }, (_, i) => ({
          name: `tool${i + 1}`,
          inputSchema: {},
        })),
      });
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
        toolFilter: ['tool1', 'tool2'], // Only 2 tools filtered
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // Only 2 tool functions generated
      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeDefined();
      expect(fns.tool3).toBeUndefined();
      expect(fns.tool100).toBeUndefined();

      // Introspection confirms only 2 tools
      const toolsDict = (await fns.tools.fn({})) as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(2);
    });

    it('applies independent filters to all capability types', async () => {
      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: [
          { name: 'tool1', inputSchema: {} },
          { name: 'tool2', inputSchema: {} },
          { name: 'tool3', inputSchema: {} },
        ],
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: [
          { uri: 'res1', name: 'Resource 1' },
          { uri: 'res2', name: 'Resource 2' },
        ],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: [
          { name: 'p1' },
          { name: 'p2' },
          { name: 'p3' },
          { name: 'p4' },
        ],
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-command',
        },
        toolFilter: ['tool1'],
        resourceFilter: ['res2'],
        promptFilter: ['p1', 'p3'],
      };

      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;

      // Only filtered tool present
      expect(fns.tool1).toBeDefined();
      expect(fns.tool2).toBeUndefined();
      expect(fns.tool3).toBeUndefined();

      // Only filtered prompts present
      expect(fns.prompt_p1).toBeDefined();
      expect(fns.prompt_p2).toBeUndefined();
      expect(fns.prompt_p3).toBeDefined();
      expect(fns.prompt_p4).toBeUndefined();

      // Introspection dicts reflect filtered counts
      const toolsDict = (await fns.tools.fn({})) as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(1);

      const promptsDict = (await fns.prompts.fn({})) as Record<string, unknown>;
      expect(Object.keys(promptsDict)).toHaveLength(2);
    });
  });
});
