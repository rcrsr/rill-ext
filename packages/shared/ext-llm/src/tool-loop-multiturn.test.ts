/**
 * Unit tests for tool loop orchestration: multiturn
 */

import { describe, it, expect, vi } from 'vitest';
import {
  callable,
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
  type ToolResults,
} from './_tool-loop-helpers.js';

describe('executeToolLoop', () => {
  describe('multi-turn execution', () => {
    it('calls API again after tool execution', async () => {
      // Multi-turn: After tool execution, loop calls API again with tool results
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const mockCallAPI = vi.fn(() =>
        Promise.resolve({
          content: 'response',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      );

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        extractToolCalls: vi.fn(() => {
          // First call: return tool calls
          // Second call: return null (exit loop)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
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

      // API should be called twice: once for initial, once after tool execution
      expect(mockCallAPI).toHaveBeenCalledTimes(2);
    });

    it('exits when LLM returns no tool calls', async () => {
      // Multi-turn: Loop exits when extractToolCalls returns null
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // First call: tool calls
          // Second call: null (should exit)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
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

      // Should exit cleanly with tool results
      expect(result.toolCalls).toHaveLength(1);
      expect(result.response).toBeDefined();
    });

    it('enforces maxTurns limit (halts with max_turns_exceeded)', async () => {
      // Multi-turn: Loop halts after maxTurns reached
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      const mockCallAPI = vi.fn(() =>
        Promise.resolve({
          content: 'response',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      );

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        extractToolCalls: vi.fn(() => {
          // Always return tool calls (simulate infinite loop)
          return [{ id: 'call_1', name: 'tool', input: {} }];
        }),
      });

      // max_turns exceeded → throw with max_turns_exceeded message
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn<EmitEvent>(),
          5 // maxTurns = 5
        )
      ).rejects.toThrow('tool_loop exceeded max_turns (5)');

      // API should be called exactly 5 times
      expect(mockCallAPI).toHaveBeenCalledTimes(5);
    });

    it('aggregates tokens across multiple turns', async () => {
      // Multi-turn: Token usage aggregated across all API calls
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => {
          // Each call uses different token amounts
          apiCallCount++;
          return Promise.resolve({
            content: 'response',
            usage: {
              input_tokens: apiCallCount * 100,
              output_tokens: apiCallCount * 50,
            },
          });
        }),
        extractToolCalls: vi.fn(() => {
          // First 2 calls: tool calls
          // Third call: null (exit)
          return apiCallCount < 3
            ? [{ id: 'call_1', name: 'tool', input: {} }]
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

      // Should aggregate: (100 + 200 + 300) input, (50 + 100 + 150) output
      expect(result.totalTokens).toEqual({ input: 600, output: 300 });
    });

    it('continues loop after successful tool execution', async () => {
      // Multi-turn: After tool executes successfully, loop continues to next turn
      const tool1Fn = vi.fn(() => 'result1');
      const tool2Fn = vi.fn(() => 'result2');
      const tools = {
        tool1: createMockTool(tool1Fn),
        tool2: createMockTool(tool2Fn),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // First call: tool1
          // Second call: tool2
          // Third call: null (exit)
          apiCallCount++;
          if (apiCallCount === 1) {
            return [{ id: 'call_1', name: 'tool1', input: {} }];
          } else if (apiCallCount === 2) {
            return [{ id: 'call_2', name: 'tool2', input: {} }];
          }
          return null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      // Both tools should have been called
      expect(tool1Fn).toHaveBeenCalledTimes(1);
      expect(tool2Fn).toHaveBeenCalledTimes(1);

      // Both tool calls should be in results
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]?.name).toBe('tool1');
      expect(result.toolCalls[1]?.name).toBe('tool2');
    });

    it('appends tool results to message history', async () => {
      // Multi-turn: Tool results formatted and appended to messages
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      const mockFormatToolResult = vi.fn((results: ToolResults) => ({
        role: 'tool',
        content: results,
      }));

      let apiCallCount = 0;
      const mockCallAPI = vi.fn((messages: unknown[]) => {
        // Verify messages grow with each call
        if (apiCallCount === 1) {
          // Second call should have assistant message + tool result message appended
          expect(messages).toHaveLength(3);
          expect((messages[1] as { role: string }).role).toBe('assistant');
          expect((messages[2] as { role: string }).role).toBe('tool');
        }
        return Promise.resolve({
          content: 'response',
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      });

      const callbacks = createMockCallbacks({
        callAPI: mockCallAPI,
        formatToolResult: mockFormatToolResult,
        extractToolCalls: vi.fn(() => {
          // First call: tool calls
          // Second call: null (exit)
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: {} }]
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

      // formatToolResult should be called once
      expect(mockFormatToolResult).toHaveBeenCalledTimes(1);

      // callAPI should be called twice
      expect(mockCallAPI).toHaveBeenCalledTimes(2);
    });
  });

  describe('hallucinated tool name sanitization', () => {
    it('sanitizes hallucinated tool name and successfully invokes the tool', async () => {
      // Tool call with hallucinated suffix is sanitized so the correct tool is invoked
      const convertFn = vi.fn(() => 212);
      const tools = {
        convert_temperature: createMockTool(convertFn),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'convert_temperature<|channel|>commentary',
                  input: { value: 100 },
                },
              ]
            : null;
        }),
      });

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Convert 100C to F' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      // Tool must be invoked with the sanitized name, not treated as unknown
      expect(convertFn).toHaveBeenCalledTimes(1);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.name).toBe('convert_temperature');
      expect(result.toolCalls[0]?.result).toBe(212);
    });

    it('patches response object before formatAssistantMessage receives it', async () => {
      // formatAssistantMessage must see the sanitized name, not the hallucinated one
      const tools = {
        convert_temperature: createMockTool(() => 212),
      };

      // Simulate an OpenAI-shaped raw response that callAPI returns
      const openAIResponse = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'convert_temperature<|channel|>commentary',
                    arguments: '{"value":100}',
                  },
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      let apiCallCount = 0;
      const mockFormatAssistantMessage = vi.fn((_response: unknown) => ({
        role: 'assistant',
        content: '',
      }));

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => Promise.resolve(openAIResponse)),
        formatAssistantMessage: mockFormatAssistantMessage,
        extractToolCalls: vi.fn(() => {
          apiCallCount++;
          return apiCallCount === 1
            ? [
                {
                  id: 'call_1',
                  name: 'convert_temperature<|channel|>commentary',
                  input: { value: 100 },
                },
              ]
            : null;
        }),
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Convert 100C to F' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      // formatAssistantMessage is called with the response object, which must be patched
      expect(mockFormatAssistantMessage).toHaveBeenCalled();
      const receivedResponse = mockFormatAssistantMessage.mock.calls[0]?.[0] as
        | typeof openAIResponse
        | undefined;
      const toolCallName =
        receivedResponse?.choices[0]?.message?.tool_calls[0]?.function?.name;
      expect(toolCallName).toBe('convert_temperature');
    });

    it('does not modify clean tool names without invalid characters', async () => {
      // Names containing only [a-zA-Z0-9_-] must pass through unchanged
      const cleanFn = vi.fn(() => 'ok');
      const tools = {
        clean_tool_name: createMockTool(cleanFn),
      };

      let apiCallCount = 0;
      const mockFormatAssistantMessage = vi.fn((_response: unknown) => ({
        role: 'assistant',
        content: '',
      }));

      const openAIResponse = {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'clean_tool_name',
                    arguments: '{}',
                  },
                },
              ],
            },
          },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      };

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => Promise.resolve(openAIResponse)),
        formatAssistantMessage: mockFormatAssistantMessage,
        extractToolCalls: vi.fn(() => {
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'clean_tool_name', input: {} }]
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

      // Tool must be invoked normally
      expect(cleanFn).toHaveBeenCalledTimes(1);
      expect(result.toolCalls[0]?.name).toBe('clean_tool_name');

      // Response object must not be mutated — name remains as-is
      const receivedResponse = mockFormatAssistantMessage.mock.calls[0]?.[0] as
        | typeof openAIResponse
        | undefined;
      const toolCallName =
        receivedResponse?.choices[0]?.message?.tool_calls[0]?.function?.name;
      expect(toolCallName).toBe('clean_tool_name');
    });
  });

  // ============================================================
  // DICT-FORM VALIDATION
  // ============================================================

  describe('dict-form tools validation', () => {
    // Shared mock ScriptCallable with annotations
    const mockScriptCallable: ScriptCallable = {
      __type: 'callable',
      kind: 'script',
      returnType: anyTypeValue,
      params: [
        {
          name: 'query',
          type: { kind: 'string' } as const,
          defaultValue: undefined,
          annotations: { description: 'Search query' },
        },
      ],
      body: {} as never,
      definingScope: {
        variables: new Map(),
        pipeValue: null,
      } as never,
      annotations: { description: 'Search the web' },
      isProperty: false,
    };

    // Shared mock ApplicationCallable with description
    const mockAppCallable: ApplicationCallable = {
      ...callable(() => ''),
      params: [
        {
          name: 'q',
          type: { kind: 'string' } as const,
          defaultValue: undefined,
          annotations: {},
        },
      ],
      fn: (args: Record<string, RillValue>) => args['q'] ?? null,
      annotations: { description: 'My tool description' },
      isProperty: false,
    };

    describe('callable with no description produces empty string', () => {
      it('uses empty string when ApplicationCallable has no description', async () => {
        const noDescTool: ApplicationCallable = {
          ...callable(() => ''),
          params: [],
          fn: () => 'result',
          isProperty: false,
          // No description field
        };
        const tools = { silent_tool: noDescTool } as unknown as RillValue;

        const buildTools = vi.fn((descriptors: ToolDescriptors) => descriptors);
        const callbacks = createMockCallbacks({
          buildTools,
          extractToolCalls: vi.fn(() => null),
          callAPI: vi.fn(() =>
            Promise.resolve({
              content: 'done',
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          ),
        });

        await executeToolLoop([], tools, 3, callbacks, vi.fn<EmitEvent>(), 1);

        const descriptors = buildTools.mock.calls[0]?.[0] as
          | Array<{ description: string }>
          | undefined;
        expect(descriptors?.[0]?.description).toBe('');
      });

      it('uses empty string when ScriptCallable has no description annotation', async () => {
        const noDescScript: ScriptCallable = {
          __type: 'callable',
          kind: 'script',
          returnType: anyTypeValue,
          params: [],
          body: {} as never,
          definingScope: { variables: new Map(), pipeValue: null } as never,
          annotations: {},
          isProperty: false,
        };
        const tools = { quiet: noDescScript } as unknown as RillValue;

        const buildTools = vi.fn((descriptors: ToolDescriptors) => descriptors);
        const callbacks = createMockCallbacks({
          buildTools,
          extractToolCalls: vi.fn(() => null),
          callAPI: vi.fn(() =>
            Promise.resolve({
              content: 'done',
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          ),
        });

        await executeToolLoop([], tools, 3, callbacks, vi.fn<EmitEvent>(), 1);

        const descriptors = buildTools.mock.calls[0]?.[0] as
          | Array<{ description: string }>
          | undefined;
        expect(descriptors?.[0]?.description).toBe('');
      });
    });

    describe('mixed dict of ScriptCallable and ApplicationCallable is valid', () => {
      it('builds correct descriptors for mixed callable types', async () => {
        const tools = {
          script_tool: mockScriptCallable,
          app_tool: mockAppCallable,
        } as unknown as RillValue;

        const buildTools = vi.fn((descriptors: ToolDescriptors) => descriptors);
        const callbacks = createMockCallbacks({
          buildTools,
          extractToolCalls: vi.fn(() => null),
          callAPI: vi.fn(() =>
            Promise.resolve({
              content: 'done',
              usage: { input_tokens: 10, output_tokens: 5 },
            })
          ),
        });

        await executeToolLoop([], tools, 3, callbacks, vi.fn<EmitEvent>(), 1);

        const descriptors = buildTools.mock.calls[0]?.[0] as
          | Array<{ name: string; description: string }>
          | undefined;
        expect(descriptors).toHaveLength(2);

        const scriptDescriptor = descriptors?.find(
          (d) => d.name === 'script_tool'
        );
        const appDescriptor = descriptors?.find((d) => d.name === 'app_tool');

        expect(scriptDescriptor?.description).toBe('Search the web');
        expect(appDescriptor?.description).toBe('My tool description');
      });
    });
  });
});
