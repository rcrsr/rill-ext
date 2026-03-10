/**
 * Tool loop tests for tool_loop() function
 * Validates tool calling, parallel execution, error handling, and loop control
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, callable, type RillValue } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Create mock Anthropic API response with tool use.
 */
function createMockToolUseResponse(
  toolCalls: Array<{ name: string; id: string; input: Record<string, unknown> }>
) {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me call some tools.' },
      ...toolCalls.map((tool) => ({
        type: 'tool_use',
        id: tool.id,
        name: tool.name,
        input: tool.input,
      })),
    ],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

/**
 * Create mock Anthropic API response with text only (no tools).
 */
function createMockTextResponse(content: string) {
  return {
    id: 'msg_test456',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 15 },
  };
}

// Mock the Anthropic SDK at module level
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, _error: any, message: string, _headers: any) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

/**
 * Create an ApplicationCallable with description and param metadata for tool_loop tests.
 * Converts old {name, description, params, fn} format to the new dict-form callable.
 */
function makeTool(
  fn: (args: RillValue[]) => RillValue | Promise<RillValue>,
  options?: {
    description?: string;
    params?: Array<{ name: string; type: string; description?: string }>;
  }
): RillValue {
  const tool = callable(fn);
  if (options?.description !== undefined) {
    (tool as Record<string, unknown>)['description'] = options.description;
  }
  if (options?.params !== undefined) {
    (tool as Record<string, unknown>)['params'] = options.params.map((p) => ({
      name: p.name,
      type: { type: p.type },
      defaultValue: undefined,
      annotations: p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('basic functionality', () => {
    // AC-6: tool_loop executes loop and returns dict
    it('executes single tool call and returns result', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Mock sequence: tool_use -> final response
      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'get_weather', id: 'tool_1', input: { location: 'SF' } },
          ])
        )
        .mockResolvedValueOnce(
          createMockTextResponse('The weather in SF is sunny.')
        );

      const tools = {
        get_weather: makeTool(
          (args) => {
            expect(args[0]).toBe('SF');
            return 'Sunny, 72°F';
          },
          {
            description: 'Get weather',
            params: [{ name: 'location', type: 'string', description: 'City name' }],
          }
        ),
      };

      const result = (await ext.tool_loop.fn(
        ['What is the weather in SF?', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('The weather in SF is sunny.');
      expect(result['turns']).toBe(2);
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['usage']).toEqual({ input: 15, output: 35 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    // AC-26: 0 tool calls returns immediately
    it('returns immediately when no tool calls made', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate.mockResolvedValueOnce(
        createMockTextResponse('I can answer that directly: 42')
      );

      const tools = {
        calculator: makeTool(() => 'result', { description: 'Calculate' }),
      };

      const result = (await ext.tool_loop.fn(
        ['What is the answer?', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('I can answer that directly: 42');
      expect(result['turns']).toBe(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // AC-25: max_turns:1 returns after single LLM response
    it('respects max_turns limit', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate.mockResolvedValueOnce(
        createMockToolUseResponse([
          { name: 'search', id: 'tool_1', input: { query: 'test' } },
        ])
      );

      const tools = {
        search: makeTool(() => 'results', {
          description: 'Search',
          params: [{ name: 'query', type: 'string', description: 'Query' }],
        }),
      };

      const result = (await ext.tool_loop.fn(
        ['Search for something', { tools, max_turns: 1 }],
        ctx
      )) as Record<string, unknown>;

      expect(result['stop_reason']).toBe('max_turns');
      expect(result['turns']).toBe(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('parallel tool execution', () => {
    it('executes multiple tool calls concurrently', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'tool_a', id: 'tool_1', input: {} },
            { name: 'tool_b', id: 'tool_2', input: {} },
            { name: 'tool_c', id: 'tool_3', input: {} },
          ])
        )
        .mockResolvedValueOnce(createMockTextResponse('All tools completed'));

      const executionOrder: string[] = [];
      const makeConcurrentTool = (name: string) =>
        makeTool(
          async () => {
            executionOrder.push(`${name}-start`);
            await new Promise((resolve) => setTimeout(resolve, 10));
            executionOrder.push(`${name}-end`);
            return `${name} result`;
          },
          { description: `Tool ${name}` }
        );

      const tools = {
        tool_a: makeConcurrentTool('A'),
        tool_b: makeConcurrentTool('B'),
        tool_c: makeConcurrentTool('C'),
      };

      await ext.tool_loop.fn(['Run tools', { tools }], ctx);

      // All tools should start before any finish (parallel execution)
      expect(executionOrder.filter((e) => e.endsWith('-start')).length).toBe(3);
      expect(executionOrder.indexOf('A-start')).toBeLessThan(
        executionOrder.indexOf('B-end')
      );
    });
  });

  describe('error handling', () => {
    // EC-22: Empty prompt raises error
    it('throws error for empty prompt', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(
        ext.tool_loop.fn(['   ', { tools: {} }], ctx)
      ).rejects.toThrow('prompt text cannot be empty');
    });

    // EC-23: Missing tools in options raises error
    it('throws error when tools option missing', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      await expect(ext.tool_loop.fn(['Test', {}], ctx)).rejects.toThrow(
        "tool_loop requires 'tools' option"
      );
    });

    // EC-15: Unknown tool name in tool loop
    it('does not throw immediately for single unknown tool', async () => {
      // Single unknown tool (< maxErrors threshold) records error but completes
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // First API call returns unknown tool, second returns text response (exits loop)
      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'unknown_tool', id: 'tool_1', input: {} },
          ])
        )
        .mockResolvedValueOnce(createMockTextResponse('Done'));

      const tools = {
        known_tool: makeTool(() => 'result', { description: 'Known tool' }),
      };

      // Should complete without throwing despite unknown tool error
      const result = await ext.tool_loop.fn(['Test', { tools }], ctx);

      // Verify result structure
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('turns');
      const turns = (result as Record<string, unknown>).turns;
      expect(turns).toBe(2); // Two turns: tool error + final response
    });

    // EC-25: max_errors exceeded aborts loop
    it('aborts after max consecutive errors', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Mock 3 consecutive tool_use responses
      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'failing_tool', id: 'tool_1', input: {} },
          ])
        )
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'failing_tool', id: 'tool_2', input: {} },
          ])
        )
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            { name: 'failing_tool', id: 'tool_3', input: {} },
          ])
        );

      const tools = {
        failing_tool: makeTool(
          () => {
            throw new Error('Tool failed');
          },
          { description: 'Failing tool' }
        ),
      };

      await expect(
        ext.tool_loop.fn(['Test', { tools, max_errors: 3 }], ctx)
      ).rejects.toThrow('Tool execution failed: 3 consecutive errors');
    });

    it('resets consecutive error count on success', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      let callCount = 0;

      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        )
        .mockResolvedValueOnce(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_2', input: {} }])
        )
        .mockResolvedValueOnce(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_3', input: {} }])
        )
        .mockResolvedValueOnce(createMockTextResponse('Done'));

      const tools = {
        tool: makeTool(
          () => {
            callCount++;
            if (callCount === 1 || callCount === 2) {
              throw new Error('Fail');
            }
            return 'success';
          },
          { description: 'Tool' }
        ),
      };

      const result = (await ext.tool_loop.fn(
        ['Test', { tools, max_errors: 3 }],
        ctx
      )) as Record<string, unknown>;

      expect(result['content']).toBe('Done');
      expect(callCount).toBe(3);
    });

    it('sends tool errors to LLM as tool_result', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        )
        .mockResolvedValueOnce(createMockTextResponse('Handled error'));

      const tools = {
        tool: makeTool(
          () => {
            throw new Error('Custom error message');
          },
          { description: 'Tool' }
        ),
      };

      await ext.tool_loop.fn(['Test', { tools }], ctx);

      // Check second API call includes error in tool_result
      const secondCall = mockCreate.mock.calls[1]?.[0] as any;
      expect(secondCall.messages).toBeDefined();
      const lastMessage = secondCall.messages[secondCall.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(lastMessage.content).toBeInstanceOf(Array);
      expect(lastMessage.content[0].type).toBe('tool_result');
      expect(lastMessage.content[0].is_error).toBe(true);
      expect(lastMessage.content[0].content).toContain('Custom error message');
    });
  });

  describe('message history', () => {
    it('prepends messages option to conversation', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate.mockResolvedValueOnce(createMockTextResponse('Response'));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const messages = [
        { role: 'user', content: 'Previous message 1' },
        { role: 'assistant', content: 'Previous response 1' },
      ];

      await ext.tool_loop.fn(['New prompt', { tools, messages }], ctx);

      const firstCall = mockCreate.mock.calls[0]?.[0] as any;
      expect(firstCall.messages.length).toBe(3);
      expect(firstCall.messages[0]).toEqual({
        role: 'user',
        content: 'Previous message 1',
      });
      expect(firstCall.messages[1]).toEqual({
        role: 'assistant',
        content: 'Previous response 1',
      });
      expect(firstCall.messages[2]).toEqual({
        role: 'user',
        content: 'New prompt',
      });
    });

    it('returns full conversation history in result', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        )
        .mockResolvedValueOnce(createMockTextResponse('Final response'));

      const tools = {
        tool: makeTool(() => 'tool result', { description: 'Tool' }),
      };

      const result = (await ext.tool_loop.fn(
        ['Test prompt', { tools }],
        ctx
      )) as Record<string, unknown>;

      const messages = result['messages'] as Array<Record<string, unknown>>;
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toEqual({ role: 'user', content: 'Test prompt' });
    });
  });

  describe('token aggregation', () => {
    it('aggregates token usage across all turns', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce({
          ...createMockToolUseResponse([
            { name: 'tool', id: 'tool_1', input: {} },
          ]),
          usage: { input_tokens: 100, output_tokens: 50 },
        })
        .mockResolvedValueOnce({
          ...createMockTextResponse('Done'),
          usage: { input_tokens: 200, output_tokens: 75 },
        });

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const result = (await ext.tool_loop.fn(
        ['Test', { tools }],
        ctx
      )) as Record<string, unknown>;

      expect(result['usage']).toEqual({
        input: 300, // 100 + 200
        output: 125, // 50 + 75
      });
    });
  });

  describe('tool parameter mapping', () => {
    it('converts rill types to JSON Schema', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate.mockResolvedValueOnce(createMockTextResponse('Done'));

      const tools = {
        complex_tool: makeTool(() => 'result', {
          description: 'Tool with various param types',
          params: [
            { name: 'str_param', type: 'string', description: 'A string' },
            { name: 'num_param', type: 'number', description: 'A number' },
            { name: 'bool_param', type: 'bool', description: 'A boolean' },
            { name: 'list_param', type: 'list', description: 'A list' },
            { name: 'dict_param', type: 'dict', description: 'A dict' },
          ],
        }),
      };

      await ext.tool_loop.fn(['Test', { tools }], ctx);

      const firstCall = mockCreate.mock.calls[0]?.[0] as any;
      const tool = firstCall.tools[0];

      expect(tool.input_schema.properties['str_param'].type).toBe('string');
      expect(tool.input_schema.properties['num_param'].type).toBe('number');
      expect(tool.input_schema.properties['bool_param'].type).toBe('boolean');
      expect(tool.input_schema.properties['list_param'].type).toBe('array');
      expect(tool.input_schema.properties['dict_param'].type).toBe('object');
    });

    it('passes tool arguments to callable in correct order', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce(
          createMockToolUseResponse([
            {
              name: 'tool',
              id: 'tool_1',
              input: { param_a: 'value_a', param_b: 42 },
            },
          ])
        )
        .mockResolvedValueOnce(createMockTextResponse('Done'));

      let capturedArgs: RillValue[] | null = null;

      const tools = {
        tool: makeTool(
          (args) => {
            capturedArgs = args;
            return 'result';
          },
          {
            description: 'Tool',
            params: [
              { name: 'param_a', type: 'string', description: 'Param A' },
              { name: 'param_b', type: 'number', description: 'Param B' },
            ],
          }
        ),
      };

      await ext.tool_loop.fn(['Test', { tools }], ctx);

      expect(capturedArgs).toEqual(['value_a', 42]);
    });
  });

  describe('concurrent independent calls', () => {
    // AC-27: Multiple concurrent tool_loop() calls operate independently
    it('handles multiple concurrent tool_loop calls independently', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx1 = createRuntimeContext();
      const ctx2 = createRuntimeContext();

      mockCreate
        .mockResolvedValueOnce(createMockTextResponse('Response 1'))
        .mockResolvedValueOnce(createMockTextResponse('Response 2'));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const [result1, result2] = await Promise.all([
        ext.tool_loop.fn(['Prompt 1', { tools }], ctx1),
        ext.tool_loop.fn(['Prompt 2', { tools }], ctx2),
      ]);

      const r1 = result1 as Record<string, unknown>;
      const r2 = result2 as Record<string, unknown>;

      expect(r1['content']).toBe('Response 1');
      expect(r2['content']).toBe('Response 2');
    });
  });
});
