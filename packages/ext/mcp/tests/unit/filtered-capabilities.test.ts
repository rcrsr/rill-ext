/**
 * End-to-end tests for filtered capabilities.
 *
 * Coverage:
 * - BC-7: Server with 10 tools, filter to 2, verify only 2 functions generated
 * - BC-7: Introspection dicts reflect filtered set
 * - AC-5: Name collision with filter (_2 suffix)
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

describe('Filtered Capabilities End-to-End', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
      resources: {},
      prompts: {},
    });
  });

  describe('BC-7: Filtered tool function generation', () => {
    it('generates only filtered tool functions and introspection dicts match', async () => {
      // Arrange - Mock server with 10 tools
      const allTools = Array.from({ length: 10 }, (_, i) => ({
        name: `tool${i + 1}`,
        description: `Tool ${i + 1}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['tool1', 'tool2'], // Filter to only 2 tools
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - Only 2 tools dict entries generated (tool1, tool2)
      expect(tools.tool1).toBeDefined();
      expect(tools.tool2).toBeDefined();

      // Other tools NOT generated as tools dict entries
      expect(tools.tool3).toBeUndefined();
      expect(tools.tool4).toBeUndefined();
      expect(tools.tool5).toBeUndefined();
      expect(tools.tool6).toBeUndefined();
      expect(tools.tool7).toBeUndefined();
      expect(tools.tool8).toBeUndefined();
      expect(tools.tool9).toBeUndefined();
      expect(tools.tool10).toBeUndefined();

      // Assert - Introspection returns callable dict for filtered tools
      expect(fns.tools).toBeDefined();
      const allToolsDict = fns.tools as Record<string, unknown>;
      // Only filtered tools (tool1, tool2) are present in the callable dict
      expect(Object.keys(allToolsDict)).toHaveLength(2);
      expect(allToolsDict['tool1']).toBeDefined();
      expect(allToolsDict['tool2']).toBeDefined();
    });

    it('generates all functions when no filter specified', async () => {
      // Arrange - Mock server with 5 tools, no filter
      const allTools = Array.from({ length: 5 }, (_, i) => ({
        name: `tool${i + 1}`,
        description: `Tool ${i + 1}`,
        inputSchema: { type: 'object', properties: {} },
      }));

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        // No toolFilter - all tools should be included
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - All 5 tools dict entries generated
      expect(tools.tool1).toBeDefined();
      expect(tools.tool2).toBeDefined();
      expect(tools.tool3).toBeDefined();
      expect(tools.tool4).toBeDefined();
      expect(tools.tool5).toBeDefined();

      // Assert - Introspection returns callable dict for all 5 tools
      const allToolsDict = fns.tools as Record<string, unknown>;
      expect(Object.keys(allToolsDict)).toHaveLength(5);
    });

    it('generates no functions when filter matches no tools', async () => {
      // Arrange - Mock server with 3 tools, filter matches none
      const allTools = [
        { name: 'tool1', description: 'Tool 1', inputSchema: {} },
        { name: 'tool2', description: 'Tool 2', inputSchema: {} },
        { name: 'tool3', description: 'Tool 3', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['nonexistent-tool'], // No matches
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - No tools dict entries generated
      expect(tools.tool1).toBeUndefined();
      expect(tools.tool2).toBeUndefined();
      expect(tools.tool3).toBeUndefined();

      // Assert - Introspection returns empty callable dict (filter matched nothing)
      const allToolsDict = fns.tools as Record<string, unknown>;
      expect(Object.keys(allToolsDict)).toHaveLength(0);
    });
  });

  describe('AC-5: Name collision with filter', () => {
    it('applies _2 suffix to colliding names within filtered set', async () => {
      // Arrange - Mock server with colliding tool names
      const allTools = [
        { name: 'read-file', description: 'Read file tool', inputSchema: {} },
        { name: 'readFile', description: 'Read file alt', inputSchema: {} },
        { name: 'other-tool', description: 'Other tool', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['read-file', 'readFile'], // Both collide to read_file
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - First collision gets base name, second gets _2 suffix
      expect(tools.read_file).toBeDefined();
      expect(tools.read_file_2).toBeDefined();

      // Assert - Other tool not included (not in filter)
      expect(tools.other_tool).toBeUndefined();

      // Assert - Introspection returns callable dict for filtered tools only
      const allToolsDict = fns.tools as Record<string, unknown>;
      // Both read-file and readFile are in the filter (2 tools, collision-renamed)
      expect(Object.keys(allToolsDict)).toHaveLength(2);
    });

    it('handles three-way collision in filtered set', async () => {
      // Arrange - Three tools that collide when sanitized
      const allTools = [
        { name: 'fetch-data', description: 'Fetch 1', inputSchema: {} },
        { name: 'fetchData', description: 'Fetch 2', inputSchema: {} },
        { name: 'fetch.data', description: 'Fetch 3', inputSchema: {} },
        { name: 'other-tool', description: 'Other', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['fetch-data', 'fetchData', 'fetch.data'], // All collide
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - Three tools dict entries with collision numbering
      expect(tools.fetch_data).toBeDefined();
      expect(tools.fetch_data_2).toBeDefined();
      expect(tools.fetch_data_3).toBeDefined();

      // Assert - Other tool not included
      expect(tools.other_tool).toBeUndefined();

      // Assert - Introspection returns callable dict for filtered tools only (3 collision-renamed)
      const allToolsDict = fns.tools as Record<string, unknown>;
      expect(Object.keys(allToolsDict)).toHaveLength(3);
    });

    it('collision numbering independent when different tools filtered', async () => {
      // Arrange - Same colliding names but only one in filter
      const allTools = [
        { name: 'read-file', description: 'Read file tool', inputSchema: {} },
        { name: 'readFile', description: 'Read file alt', inputSchema: {} },
        { name: 'other-tool', description: 'Other tool', inputSchema: {} },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
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
          command: 'mock-server',
        },
        toolFilter: ['read-file', 'other-tool'], // Only first of collision pair
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;

      // Assert - No collision, no _2 suffix needed
      expect(tools.read_file).toBeDefined();
      expect(tools.other_tool).toBeDefined();
      expect(tools.read_file_2).toBeUndefined(); // Second not included in filter
    });
  });

  describe('Integration with other capability types', () => {
    it('filters tools while leaving resources and prompts unfiltered', async () => {
      // Arrange - Multiple capability types
      const allTools = [
        { name: 'tool1', inputSchema: {} },
        { name: 'tool2', inputSchema: {} },
        { name: 'tool3', inputSchema: {} },
      ];
      const allResources = [
        { uri: 'file://resource1', name: 'Resource 1' },
        { uri: 'file://resource2', name: 'Resource 2' },
      ];
      const allPrompts = [
        { name: 'prompt1', description: 'Prompt 1' },
        { name: 'prompt2', description: 'Prompt 2' },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: allResources,
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: allPrompts,
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-server',
        },
        toolFilter: ['tool1'], // Only filter tools
        // No resource or prompt filters
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;
      const resources = fns.resources as Record<string, any>;
      const prompts = fns.prompts as Record<string, any>;

      // Assert - Only tool1 tools dict entry generated
      expect(tools.tool1).toBeDefined();
      expect(tools.tool2).toBeUndefined();
      expect(tools.tool3).toBeUndefined();

      // Assert - read_resource exists in resources dict (not filtered)
      expect(resources.read_resource).toBeDefined();

      // Assert - Prompt functions generated for all prompts (not filtered)
      expect(prompts.prompt1).toBeDefined();
      expect(prompts.prompt2).toBeDefined();

      // Assert - tools returns callable dict for filtered tools only (tool1)
      const toolsDict = fns.tools as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(1);
      expect(toolsDict['tool1']).toBeDefined();

      // Assert - resources returns callable dict (read_resource + 2 static resource functions)
      const resourcesDict = fns.resources as Record<string, unknown>;
      expect(Object.keys(resourcesDict)).toHaveLength(3);
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(resourcesDict['resource_resource_1']).toBeDefined();
      expect(resourcesDict['resource_resource_2']).toBeDefined();

      // Assert - prompts returns callable dict for all unfiltered prompts
      const promptsDict = fns.prompts as Record<string, unknown>;
      expect(Object.keys(promptsDict)).toHaveLength(2);
      expect(promptsDict['prompt1']).toBeDefined();
      expect(promptsDict['prompt2']).toBeDefined();
    });

    it('applies filters to all capability types independently', async () => {
      // Arrange - All capability types with filters
      const allTools = [
        { name: 'tool1', inputSchema: {} },
        { name: 'tool2', inputSchema: {} },
      ];
      const allResources = [
        { uri: 'file://resource1', name: 'Resource 1' },
        { uri: 'file://resource2', name: 'Resource 2' },
      ];
      const allPrompts = [
        { name: 'prompt1', description: 'Prompt 1' },
        { name: 'prompt2', description: 'Prompt 2' },
      ];

      vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
      vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
        tools: allTools,
      });
      vi.spyOn(Client.prototype, 'listResources').mockResolvedValue({
        resources: allResources,
      });
      vi.spyOn(Client.prototype, 'listResourceTemplates').mockResolvedValue({
        resourceTemplates: [],
      });
      vi.spyOn(Client.prototype, 'listPrompts').mockResolvedValue({
        prompts: allPrompts,
      });

      const config: McpExtensionConfig = {
        transport: {
          type: 'stdio',
          command: 'mock-server',
        },
        toolFilter: ['tool1'],
        resourceFilter: ['file://resource2'],
        promptFilter: ['prompt1'],
      };

      // Act
      const result = await createMcpExtension(config);
      const fns = result.value as Record<string, any>;
      const tools = fns.tools as Record<string, any>;
      const resources = fns.resources as Record<string, any>;
      const prompts = fns.prompts as Record<string, any>;

      // Assert - Only filtered tools dict entries generated
      expect(tools.tool1).toBeDefined();
      expect(tools.tool2).toBeUndefined();

      expect(prompts.prompt1).toBeDefined();
      expect(prompts.prompt2).toBeUndefined();

      // Assert - read_resource exists in resources dict (resource filter doesn't affect its existence)
      expect(resources.read_resource).toBeDefined();

      // Assert - tools returns callable dict for filtered tools only (tool1)
      const toolsDict = fns.tools as Record<string, unknown>;
      expect(Object.keys(toolsDict)).toHaveLength(1);
      expect(toolsDict['tool1']).toBeDefined();

      // Assert - resources returns callable dict (read_resource + filtered static resource)
      const resourcesDict = fns.resources as Record<string, unknown>;
      expect(Object.keys(resourcesDict)).toHaveLength(2);
      expect(resourcesDict['read_resource']).toBeDefined();
      expect(resourcesDict['resource_resource_2']).toBeDefined();

      // Assert - prompts returns callable dict for filtered prompts only (prompt1)
      const promptsDict = fns.prompts as Record<string, unknown>;
      expect(Object.keys(promptsDict)).toHaveLength(1);
      expect(promptsDict['prompt1']).toBeDefined();
    });
  });
});
