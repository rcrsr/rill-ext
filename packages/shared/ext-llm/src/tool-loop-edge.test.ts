/**
 * Unit tests for tool loop orchestration: edge
 */

import { describe, it, expect, vi } from 'vitest';
import {
  callable,
  createRuntimeContext,
  invokeCallable,
  anyTypeValue,
  type ApplicationCallable,
  type RillValue,
  type ScriptCallable,
} from '@rcrsr/rill';
import { executeToolLoop } from './tool-loop.js';
import {
  createMockTool,
  createMockCallbacks,
  type EmitEvent,
  type ToolDescriptors,
} from './_tool-loop-helpers.js';

vi.mock('@rcrsr/rill', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@rcrsr/rill')>();
  return {
    ...mod,
    invokeCallable: vi.fn(mod.invokeCallable),
  };
});

describe('executeToolLoop', () => {
  describe('edge cases', () => {
    it('handles response without usage tracking', async () => {
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => Promise.resolve({ content: 'response' })),
        extractToolCalls: vi.fn(() => null),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(result.totalTokens).toEqual({ input: 0, output: 0 });
    });

    it('handles partial usage data', async () => {
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() =>
          Promise.resolve({
            content: 'response',
            usage: { input_tokens: 50 }, // Missing output_tokens
          })
        ),
        extractToolCalls: vi.fn(() => null),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(result.totalTokens).toEqual({ input: 50, output: 0 });
    });

    it('builds tool descriptors from callable metadata', async () => {
      const toolFn = createMockTool(() => 'result', 'Test tool description');
      const tools = {
        test_tool: toolFn,
      };

      const buildTools = vi.fn((toolsArg: ToolDescriptors) => toolsArg);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(buildTools).toHaveBeenCalledWith([
        {
          name: 'test_tool',
          description: 'Test tool description',
          input_schema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ]);
    });

    it('generates JSON Schema from ScriptCallable params', async () => {
      // ScriptCallable with typed params (from tool 3-arg form) builds correct schema
      const scriptTool: ScriptCallable = {
        __type: 'callable',
        kind: 'script',
        returnType: anyTypeValue,
        isProperty: false,
        params: [
          {
            name: 'city',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'count',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'optional_flag',
            type: { kind: 'bool' },
            defaultValue: true,
            annotations: {},
          },
        ],
        body: {} as never, // Not invoked in schema-build step
        definingScope: {} as never,
        annotations: { description: 'Weather lookup tool' },
      };

      const tools = { get_weather: scriptTool };

      const buildTools = vi.fn((toolsArg: ToolDescriptors) => toolsArg);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      const toolDescriptors = buildTools.mock.calls[0]![0];
      expect(toolDescriptors).toHaveLength(1);

      const descriptor = toolDescriptors[0]!;
      expect(descriptor.name).toBe('get_weather');
      expect(descriptor.input_schema.type).toBe('object');
      expect(descriptor.input_schema.properties['city']).toEqual({
        type: 'string',
      });
      expect(descriptor.input_schema.properties['count']).toEqual({
        type: 'number',
      });
      // optional_flag has a default value — not in required
      expect(descriptor.input_schema.required).toEqual(['city', 'count']);
      expect(descriptor.input_schema.required).not.toContain('optional_flag');
    });

    it('generates JSON Schema from ApplicationCallable params', async () => {
      // Tool descriptors include params metadata
      const toolFn: ApplicationCallable = {
        ...callable(() => ''),
        params: [
          {
            name: 'str_param',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'A string parameter' },
          },
          {
            name: 'num_param',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: { description: 'A number parameter' },
          },
          {
            name: 'bool_param',
            type: { kind: 'bool' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'list_param',
            type: { kind: 'list' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'dict_param',
            type: { kind: 'dict' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'optional_param',
            type: { kind: 'string' },
            defaultValue: 'default value',
            annotations: {},
          },
        ],
        fn: () => 'result',
        annotations: { description: 'Tool with params' },
      };

      const tools = {
        test_tool: toolFn,
      };

      const buildTools = vi.fn((toolsArg: ToolDescriptors) => toolsArg);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      const toolDescriptors = buildTools.mock.calls[0]![0];
      expect(toolDescriptors).toHaveLength(1);

      const descriptor = toolDescriptors[0]!;
      expect(descriptor.name).toBe('test_tool');
      expect(descriptor.description).toBe('Tool with params');
      expect(descriptor.input_schema.type).toBe('object');
      expect(descriptor.input_schema.properties['str_param']).toEqual({
        type: 'string',
        description: 'A string parameter',
      });
      expect(descriptor.input_schema.properties['num_param']).toEqual({
        type: 'number',
        description: 'A number parameter',
      });
      expect(descriptor.input_schema.properties['bool_param']).toEqual({
        type: 'boolean',
      });
      expect(descriptor.input_schema.properties['list_param']).toEqual({
        type: 'array',
      });
      expect(descriptor.input_schema.properties['dict_param']).toEqual({
        type: 'object',
        additionalProperties: false,
      });
      expect(descriptor.input_schema.required).toEqual([
        'str_param',
        'num_param',
        'bool_param',
        'list_param',
        'dict_param',
      ]);
    });

    it('produces unconstrained property {} when param.type is undefined', async () => {
      // param.type undefined → JSON Schema property {}
      const toolFn: ApplicationCallable = {
        ...callable(() => ''),
        params: [
          {
            name: 'unconstrained',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: () => 'result',
        annotations: { description: 'Tool with unconstrained param' },
      };

      const buildTools = vi.fn((toolsArg: ToolDescriptors) => toolsArg);
      const callbacks = createMockCallbacks({
        buildTools,
        extractToolCalls: vi.fn(() => null),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        { test_tool: toolFn },
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      const descriptor = buildTools.mock.calls[0]![0][0]!;
      // Unconstrained param produces {} (no type field)
      expect(descriptor.input_schema.properties['unconstrained']).toEqual({});
      expect(descriptor.input_schema.required).toContain('unconstrained');
    });
  });

  describe('argument conversion', () => {
    it('passes dict input as named args to application callable', async () => {
      // Dict input passed as named args
      const mockFn = vi.fn((_args: Record<string, RillValue>) => 'success');

      const toolFn: ApplicationCallable = {
        ...callable(() => ''),
        params: [
          {
            name: 'param_a',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'param_b',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        test_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  input: { param_a: 'value_a', param_b: 42 },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(
        { param_a: 'value_a', param_b: 42 },
        expect.anything()
      );
    });

    it('passes all named args regardless of input key order', async () => {
      // Named args passed correctly regardless of input key order
      const mockFn = vi.fn((_args: Record<string, RillValue>) => 'success');

      const toolFn: ApplicationCallable = {
        ...callable(() => ''),
        params: [
          {
            name: 'first',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'second',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'third',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        test_tool: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  // Dict with keys in different order than param definition
                  input: {
                    third: 'third_value',
                    first: 'first_value',
                    second: 'second_value',
                  },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(
        { first: 'first_value', second: 'second_value', third: 'third_value' },
        expect.anything()
      );
    });

    it('passes correct named args to tool execution', async () => {
      // Tool execution passes correct named args
      const mockFn = vi.fn((args: Record<string, RillValue>) => {
        return `received: ${args['name'] as string}, ${args['age'] as number}`;
      });

      const toolFn: ApplicationCallable = {
        ...callable(() => ''),
        params: [
          {
            name: 'name',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'age',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        greet: toolFn,
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'greet',
                  input: { name: 'Alice', age: 30 },
                },
              ]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.result).toBe('received: Alice, 30');
    });

    it('handles application callable without params metadata', async () => {
      // Application callable without params gets dict as named args
      const mockFn = vi.fn((_args: Record<string, RillValue>) => 'success');

      // Malformed callable: params is absent, which the typed shape forbids
      const toolFn = {
        __type: 'callable',
        kind: 'application',
        params: undefined,
        fn: mockFn,
        isProperty: false,
      };

      const tools = {
        app_tool: toolFn,
      } as unknown as RillValue;

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'app_tool',
                  input: { param: 'value' },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(
        { param: 'value' },
        expect.anything()
      );
    });

    it('executes 0-parameter script callable tool successfully', async () => {
      // A script callable with no params — like || { "result" } => $my_tool
      // Provider sends {} as tool input; the else branch must pass [] not [{}].
      // invokeCallable is mocked to capture args and return a known result.
      const zeroParamScriptTool: ScriptCallable = {
        __type: 'callable',
        kind: 'script',
        returnType: anyTypeValue,
        params: [],
        body: {} as never,
        definingScope: { variables: new Map(), pipeValue: null } as never,
        annotations: { description: 'A tool with no parameters' },
        isProperty: false,
      };

      const tools = { zero_param_tool: zeroParamScriptTool };
      const ctx = createRuntimeContext();

      vi.mocked(invokeCallable).mockResolvedValueOnce('zero param result');

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'zero_param_tool', input: {} }]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>(),
        10,
        ctx
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('zero_param_tool');
      expect(result.toolCalls[0]?.result).toBe('zero param result');
      // Verify invokeCallable was called with empty args [], not [{}]
      expect(vi.mocked(invokeCallable)).toHaveBeenCalledWith(
        zeroParamScriptTool,
        [],
        ctx
      );
    });
  });
});
