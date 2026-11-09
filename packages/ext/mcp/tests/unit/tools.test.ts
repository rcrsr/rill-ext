/**
 * Tool function generation tests.
 *
 * Tests tool function generation, result parsing, and error handling.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { anyTypeValue, structureToTypeValue } from '@rcrsr/rill';
import { generateToolFunctions } from '../../src/tools.js';
import { makeRuntimeCtx, expectRejectsInvalid } from '../_helpers.js';
import type { McpTool, McpToolResult } from '../../src/tools.js';
import type { OutputJsonSchema } from '../../src/parsing.js';

// ============================================================
// MOCK CLIENT
// ============================================================

interface MockClient {
  callTool: Mock<() => Promise<McpToolResult>>;
}

function createMockClient(): MockClient {
  return {
    callTool: vi.fn<() => Promise<McpToolResult>>(),
  };
}

// ============================================================
// TEST TOOLS
// ============================================================

const TOOL_WITH_PARAMS: McpTool = {
  name: 'calculate-bmi',
  description: 'Calculate Body Mass Index',
  inputSchema: {
    type: 'object',
    properties: {
      weightKg: { type: 'number', description: 'Weight in kilograms' },
      heightM: { type: 'number', description: 'Height in meters' },
    },
    required: ['weightKg', 'heightM'],
  },
};

const TOOL_NO_PARAMS: McpTool = {
  name: 'get-status',
  description: 'Get server status',
  inputSchema: {
    type: 'object',
  },
};

const TOOL_OPTIONAL_PARAMS: McpTool = {
  name: 'search',
  description: 'Search for items',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'integer', description: 'Result limit' },
    },
    required: ['query'],
  },
};

// ============================================================
// RESULT HELPERS
// ============================================================

function textResult(text: string): McpToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

function errorResult(errorText: string): McpToolResult {
  return {
    content: [{ type: 'text', text: errorText }],
    isError: true,
  };
}

// ============================================================
// IR-2: TOOL FUNCTION GENERATION
// ============================================================

describe('generateToolFunctions', () => {
  describe('IR-2: HostFunctionDefinition generation', () => {
    it('generates function with params from schema', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([TOOL_WITH_PARAMS], mockClient);

      expect(functions).toHaveProperty('calculate_bmi');
      const fn = functions['calculate_bmi']!;

      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]).toMatchObject({
        name: 'weight_kg',
        type: { kind: 'number' },
        annotations: { description: 'Weight in kilograms' },
      });
      expect(fn.params[1]).toMatchObject({
        name: 'height_m',
        type: { kind: 'number' },
        annotations: { description: 'Height in meters' },
      });
      expect(fn.annotations?.['description']).toBe('Calculate Body Mass Index');
      expect(fn.returnType).toEqual(anyTypeValue);
      expect(typeof fn.fn).toBe('function');
    });

    it('generates function with no params', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([TOOL_NO_PARAMS], mockClient);

      expect(functions).toHaveProperty('get_status');
      const fn = functions['get_status']!;

      expect(fn.params).toHaveLength(0);
      expect(fn.returnType).toEqual(anyTypeValue);
    });

    it('generates function with optional params', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions(
        [TOOL_OPTIONAL_PARAMS],
        mockClient
      );

      const fn = functions['search']!;
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]!.defaultValue).toBeUndefined();
      expect(fn.params[1]!.defaultValue).toBeUndefined();
    });

    it('applies name sanitization', () => {
      const tools: McpTool[] = [
        { name: 'get-user', inputSchema: { type: 'object' } },
        { name: 'getUserProfile', inputSchema: { type: 'object' } },
        { name: 'get.user.data', inputSchema: { type: 'object' } },
      ];

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions(tools, mockClient);

      expect(functions).toHaveProperty('get_user');
      expect(functions).toHaveProperty('get_user_profile');
      expect(functions).toHaveProperty('get_user_data');
    });
  });

  // ============================================================
  // EC-6: TOOL ERROR
  // ============================================================

  describe('EC-6: Tool error handling', () => {
    it('throws RuntimeError for tool error response', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(errorResult('invalid input'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expectRejectsInvalid(
        functions['get_status']!.fn({}, makeRuntimeCtx()),
        'mcp tool "get-status": invalid input'
      );
    });
  });

  // ============================================================
  // EC-8: TIMEOUT
  // ============================================================

  describe('EC-8: Timeout handling', () => {
    it('invalidates with the tool name and timeout duration after timeout exceeded', async () => {
      vi.useFakeTimers();
      try {
        const mockClient = createMockClient();
        // callTool never settles, so only the extension's own timer ends the call
        mockClient.callTool.mockReturnValue(new Promise(() => {}));

        const functions = generateToolFunctions(
          [TOOL_NO_PARAMS],
          mockClient as unknown as Client,
          50
        );

        const outcome = expectRejectsInvalid(
          functions['get_status']!.fn({}, makeRuntimeCtx()),
          'mcp tool "get-status": timeout after 50ms'
        );
        await vi.advanceTimersByTimeAsync(50);
        await outcome;
      } finally {
        vi.useRealTimers();
      }
    });

    it('succeeds if call completes before timeout', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(textResult('ok'));
            }, 10);
          })
      );

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client,
        100
      );

      const result = await functions['get_status']!.fn({}, makeRuntimeCtx());
      expect(result).toBe('ok');
    });
  });

  // ============================================================
  // EC-9: CONNECTION LOST
  // ============================================================

  describe('EC-9: Connection lost handling', () => {
    it('throws RuntimeError for connection closed', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockRejectedValue(new Error('connection closed'));

      const functions = generateToolFunctions(
        [TOOL_NO_PARAMS],
        mockClient as unknown as Client
      );

      await expectRejectsInvalid(
        functions['get_status']!.fn({}, makeRuntimeCtx()),
        'mcp: connection lost'
      );
    });
  });

  // ============================================================
  // ARGUMENT MAPPING
  // ============================================================

  describe('Argument mapping', () => {
    it('maps positional args to tool parameters', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(textResult('ok'));

      const functions = generateToolFunctions(
        [TOOL_WITH_PARAMS],
        mockClient as unknown as Client
      );

      await functions['calculate_bmi']!.fn(
        { weight_kg: 70, height_m: 1.75 },
        makeRuntimeCtx()
      );

      // rill scripts call with sanitized snake_case names, but the MCP server
      // must receive the original schema keys (camelCase here).
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'calculate-bmi',
        arguments: {
          weightKg: 70,
          heightM: 1.75,
        },
      });
    });

    it('applies default values for missing optional args', async () => {
      const mockClient = createMockClient();
      mockClient.callTool.mockResolvedValue(textResult('ok'));

      const functions = generateToolFunctions(
        [TOOL_OPTIONAL_PARAMS],
        mockClient as unknown as Client
      );

      await functions['search']!.fn({ query: 'test' }, makeRuntimeCtx());

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          query: 'test',
          limit: undefined, // no default value in RillParam
        },
      });
    });
  });

  // ============================================================
  // BOUNDARY CONDITIONS
  // ============================================================

  describe('BC-3: Large parameter schemas', () => {
    it('handles tool with 100 parameters', () => {
      // Create a tool with 100 input parameters
      const largeSchema: McpTool = {
        name: 'large-tool',
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            Array.from({ length: 100 }, (_, i) => [
              `param${i}`,
              { type: 'string', description: `Parameter ${i}` },
            ])
          ),
          required: Array.from({ length: 50 }, (_, i) => `param${i}`), // First 50 required
        },
      };

      const mockClient = createMockClient();
      const functions = generateToolFunctions(
        [largeSchema],
        mockClient as unknown as Client
      );

      const fn = functions['large_tool'];
      expect(fn).toBeDefined();
      expect(fn!.params).toHaveLength(100);

      // All 100 params use string type with no defaultValue (RillParam shape)
      for (let i = 0; i < 100; i++) {
        const param = fn!.params[i]!;
        expect(param.name).toBe(`param${i}`);
        expect(param.type).toEqual({ kind: 'string' });
        expect(param.defaultValue).toBeUndefined();
      }
    });
  });

  // ============================================================
  // RETURN TYPE BEHAVIOR
  // ============================================================

  describe('returnType behavior', () => {
    it('returns anyTypeValue when tool has no outputSchema', () => {
      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([TOOL_NO_PARAMS], mockClient);

      expect(functions['get_status']!.returnType).toEqual(anyTypeValue);
    });

    it('returns structureToTypeValue for object outputSchema with properties', () => {
      const schema: OutputJsonSchema = {
        type: 'object',
        properties: {
          status: { type: 'string' },
          count: { type: 'number' },
        },
      };
      const tool: McpTool = {
        name: 'get-status',
        inputSchema: { type: 'object' },
        outputSchema: schema,
      };

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([tool], mockClient);

      expect(functions['get_status']!.returnType).toEqual(
        structureToTypeValue({
          kind: 'dict',
          fields: {
            status: { type: { kind: 'string' } },
            count: { type: { kind: 'number' } },
          },
        })
      );
    });

    it('returns structureToTypeValue for string outputSchema', () => {
      const schema: OutputJsonSchema = { type: 'string' };
      const tool: McpTool = {
        name: 'get-status',
        inputSchema: { type: 'object' },
        outputSchema: schema,
      };

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([tool], mockClient);

      expect(functions['get_status']!.returnType).toEqual(
        structureToTypeValue({ kind: 'string' })
      );
    });

    it('returns structureToTypeValue for array outputSchema with string items', () => {
      const schema: OutputJsonSchema = {
        type: 'array',
        items: { type: 'string' },
      };
      const tool: McpTool = {
        name: 'get-status',
        inputSchema: { type: 'object' },
        outputSchema: schema,
      };

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([tool], mockClient);

      expect(functions['get_status']!.returnType).toEqual(
        structureToTypeValue({ kind: 'list', element: { kind: 'string' } })
      );
    });

    it('returns structureToTypeValue for object outputSchema without properties', () => {
      const schema: OutputJsonSchema = { type: 'object' };
      const tool: McpTool = {
        name: 'get-status',
        inputSchema: { type: 'object' },
        outputSchema: schema,
      };

      const mockClient = createMockClient() as unknown as Client;
      const functions = generateToolFunctions([tool], mockClient);

      expect(functions['get_status']!.returnType).toEqual(
        structureToTypeValue({ kind: 'dict' })
      );
    });
  });
});
