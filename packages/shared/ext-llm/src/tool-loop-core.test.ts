/**
 * Unit tests for tool loop orchestration: core
 */

import { describe, it, expect, vi } from 'vitest';
import { RuntimeError, type RillValue } from '@rcrsr/rill';
import { executeToolLoop } from './tool-loop.js';
import {
  createMockTool,
  createMockCallbacks,
  type EmitEvent,
} from './_tool-loop-helpers.js';

describe('executeToolLoop', () => {
  describe('success cases', () => {
    it('executes without tool calls when no tools invoked', async () => {
      // With 0 tools → executes without tool calls
      const tools = {};
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => null),
      });
      const emitEvent = vi.fn<EmitEvent>();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Hello' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.response).toBeDefined();
      expect(result.toolCalls).toEqual([]);
      expect(result.totalTokens).toEqual({ input: 100, output: 50 });
      expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
    });

    it('executes single tool call successfully', async () => {
      // Tool loop executes successfully with single tool call
      const mockToolFn = vi.fn(() => 'tool result');
      const tools = {
        test_tool: createMockTool(mockToolFn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [{ id: 'call_1', name: 'test_tool', input: { param: 'value' } }]
            : null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        name: 'test_tool',
        result: 'tool result',
      });
      expect(mockToolFn).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledWith('tool_call', {
        tool_name: 'test_tool',
        args: { param: 'value' },
      });
      expect(emitEvent).toHaveBeenCalledWith(
        'tool_result',
        expect.objectContaining({
          tool_name: 'test_tool',
          duration: expect.any(Number) as number,
        })
      );
    });

    it('executes multiple tool calls in sequence', async () => {
      // Multiple tools execute successfully
      const tool1Fn = vi.fn(() => 'result 1');
      const tool2Fn = vi.fn(() => 'result 2');
      const tools = {
        tool1: createMockTool(tool1Fn),
        tool2: createMockTool(tool2Fn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [
                { id: 'call_1', name: 'tool1', input: {} },
                { id: 'call_2', name: 'tool2', input: {} },
              ]
            : null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        emitEvent
      );

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]?.name).toBe('tool1');
      expect(result.toolCalls[1]?.name).toBe('tool2');
      expect(tool1Fn).toHaveBeenCalledTimes(1);
      expect(tool2Fn).toHaveBeenCalledTimes(1);
    });

    it('handles async tool functions', async () => {
      // Async tools work correctly
      const asyncToolFn = vi.fn(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return 'async result';
      });
      const tools = {
        async_tool: createMockTool(asyncToolFn),
      };

      let callCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          callCount++;
          return callCount === 1
            ? [{ id: 'call_1', name: 'async_tool', input: {} }]
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

      expect(result.toolCalls[0]?.result).toBe('async result');
    });
  });

  describe('error cases - consecutive errors exceed threshold', () => {
    it('throws after maxErrors consecutive errors', async () => {
      // Consecutive errors exceed maxErrors → throws
      let toolCallCount = 0;
      const tools = {
        failing_tool: createMockTool(() => {
          toolCallCount++;
          throw new Error('Tool failed');
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'failing_tool', input: {} },
                { id: 'call_2', name: 'failing_tool', input: {} },
                { id: 'call_3', name: 'failing_tool', input: {} },
              ]
            : null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          emitEvent
        )
      ).rejects.toThrow('Tool execution failed: 3 consecutive errors');

      expect(toolCallCount).toBe(3);
      expect(emitEvent).toHaveBeenCalledWith(
        'tool_result',
        expect.objectContaining({
          tool_name: 'failing_tool',
          error: expect.stringContaining('Tool failed') as string,
          duration: expect.any(Number) as number,
        })
      );
    });

    it('throws on next error after reaching threshold', async () => {
      // At exactly maxErrors threshold → throws on next
      let toolCallCount = 0;
      const tools = {
        tool: createMockTool(() => {
          toolCallCount++;
          throw new Error('Error');
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'tool', input: {} },
                { id: 'call_2', name: 'tool', input: {} },
              ]
            : null;
        }),
      });

      // With maxErrors = 2, should throw after 2 consecutive errors
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          2,
          callbacks,
          vi.fn<EmitEvent>()
        )
      ).rejects.toThrow('Tool execution failed: 2 consecutive errors');

      expect(toolCallCount).toBe(2);
    });

    it('resets consecutive error count on success', async () => {
      // Error count resets after successful execution
      let callIndex = 0;
      const tools = {
        tool: createMockTool(() => {
          callIndex++;
          // Fail first 2 times, then succeed
          if (callIndex <= 2) {
            throw new Error('Error');
          }
          return 'success';
        }),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'tool', input: {} },
                { id: 'call_2', name: 'tool', input: {} },
                { id: 'call_3', name: 'tool', input: {} },
              ]
            : null;
        }),
      });

      // With maxErrors = 3, this should succeed because the third call succeeds
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]?.result).toBe('success');
    });
  });

  describe('error cases - unknown tool name', () => {
    it('does not throw immediately for unknown tool during execution', async () => {
      // Tool name not in tool map → throws when tool is executed
      // However, current implementation exits after first iteration, and errors
      // are tracked but don't halt execution unless consecutive errors exceed maxErrors
      const tools = {
        known_tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'unknown_tool', input: {} }]
            : null;
        }),
      });

      // With only 1 unknown tool call, it records error but completes
      // (maxErrors = 3, only 1 error)
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      // Tool loop completes but no successful tool calls
      expect(result.toolCalls).toHaveLength(0);
      // The failure is fed back to the model as an error result
      expect(callbacks.formatToolResult).toHaveBeenCalledWith([
        {
          id: 'call_1',
          name: 'unknown_tool',
          result: 'Unknown tool: unknown_tool',
          error: 'Unknown tool: unknown_tool',
        },
      ]);
    });

    it('throws RuntimeError after maxErrors unknown tool calls', async () => {
      // Multiple unknown tools exceed maxErrors → throws RuntimeError
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [
                { id: 'call_1', name: 'missing1', input: {} },
                { id: 'call_2', name: 'missing2', input: {} },
                { id: 'call_3', name: 'missing3', input: {} },
              ]
            : null;
        }),
      });

      const promise = executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );
      await expect(promise).rejects.toThrow(RuntimeError);
      await expect(promise).rejects.toThrow(
        'Tool execution failed: 3 consecutive errors (last: missing3: Unknown tool: missing3)'
      );
    });
  });

  describe('error cases - invalid tool input', () => {
    it('does not throw immediately for null tool input', async () => {
      // Tool input is null → error tracked but doesn't halt unless maxErrors exceeded
      const tools = {
        tool: createMockTool(() => 'result'),
      };

      let apiCallCount = 0;
      const callbacks = createMockCallbacks({
        extractToolCalls: vi.fn(() => {
          // Return tool calls on first call, null on subsequent calls
          apiCallCount++;
          return apiCallCount === 1
            ? [{ id: 'call_1', name: 'tool', input: null as unknown as object }]
            : null;
        }),
      });

      // Single error doesn't exceed maxErrors
      const result = await executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );

      expect(result.toolCalls).toHaveLength(0);
      // The failure is fed back to the model as an error result
      expect(callbacks.formatToolResult).toHaveBeenCalledWith([
        {
          id: 'call_1',
          name: 'tool',
          result: 'input must be an object',
          error: 'input must be an object',
        },
      ]);
    });
  });

  describe('error cases - provider API errors', () => {
    it('throws RuntimeError when provider callAPI throws', async () => {
      // Provider callAPI throws → throws via mapProviderError
      const tools = {};
      const apiError = new Error('API connection failed');

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => Promise.reject(apiError)),
      });

      const promise = executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>()
      );
      await expect(promise).rejects.toThrow(RuntimeError);
      await expect(promise).rejects.toThrow(
        'Provider API error: API connection failed'
      );
    });

    it('wraps non-Error API failures', async () => {
      // Provider throws non-Error object
      const tools = {};

      const callbacks = createMockCallbacks({
        callAPI: vi.fn(() => Promise.reject({ code: 'UNKNOWN' })),
      });

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn<EmitEvent>()
        )
      ).rejects.toThrow('Provider API error: Unknown error');
    });
  });

  describe('validation errors', () => {
    it('throws when tools parameter is undefined', async () => {
      const callbacks = createMockCallbacks();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          undefined,
          3,
          callbacks,
          vi.fn<EmitEvent>()
        )
      ).rejects.toThrow('tools parameter is required');
    });

    it.each([
      { label: 'a string', value: 'not a dict' },
      { label: 'a number', value: 42 },
      { label: 'an array', value: [] },
    ])('throws when tools is $label', async ({ value }) => {
      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          value as unknown as RillValue,
          3,
          createMockCallbacks(),
          vi.fn<EmitEvent>()
        )
      ).rejects.toThrow('tool_loop: tools must be a dict of name → callable');
    });

    it.each([
      { label: 'a string', name: 'invalid', value: 'not callable' },
      { label: 'a number', name: 'my_number_tool', value: 99 },
      { label: 'undefined', name: 'tool', value: undefined },
    ])(
      'throws naming "$name" when tool value is $label',
      async ({ name, value }) => {
        const tools = { [name]: value as unknown as RillValue };

        await expect(
          executeToolLoop(
            [{ role: 'user', content: 'Test' }],
            tools,
            3,
            createMockCallbacks(),
            vi.fn<EmitEvent>()
          )
        ).rejects.toThrow(`tool_loop: tool "${name}" is not a callable`);
      }
    );
  });
});
