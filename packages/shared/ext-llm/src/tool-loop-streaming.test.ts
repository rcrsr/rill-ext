/**
 * Unit tests for tool loop orchestration: streaming
 */

import { describe, it, expect, vi } from 'vitest';
import { type RillValue } from '@rcrsr/rill';
import { executeToolLoop, buildResponseMessages } from './tool-loop.js';
import {
  createMockTool,
  createMockCallbacks,
  type EmitEvent,
} from './_tool-loop-helpers.js';

// ============================================================
// YIELD CHUNK / STREAMING
// ============================================================

describe('executeToolLoop yieldChunk', () => {
  describe('when yieldChunk is undefined', () => {
    it('calls callAPI (not callAPIStreaming) and returns identical result', async () => {
      // yieldChunk=undefined — behavior identical to non-streaming path
      const mockCallAPIStreaming = vi.fn(() =>
        Promise.resolve({
          content: 'streamed',
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
      });
      const emitEvent = vi.fn<EmitEvent>();

      const result = await executeToolLoop(
        [{ role: 'user', content: 'Hello' }],
        {},
        3,
        callbacks,
        emitEvent,
        10
      );

      expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
      expect(mockCallAPIStreaming).not.toHaveBeenCalled();
      expect(result.response).toBeDefined();
    });
  });

  describe('when yieldChunk is provided and callAPIStreaming is defined', () => {
    it('uses callAPIStreaming instead of callAPI', async () => {
      // yieldChunk + callAPIStreaming defined → streaming path used
      const mockCallAPIStreaming = vi.fn((_msgs, _tools, _onTextDelta) =>
        Promise.resolve({
          content: 'streamed response',
          usage: { input_tokens: 20, output_tokens: 10 },
        })
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
      });
      const emitEvent = vi.fn<EmitEvent>();
      const chunks: unknown[] = [];
      const yieldChunk = vi.fn((chunk: unknown) => {
        chunks.push(chunk);
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Hello' }],
        {},
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      expect(mockCallAPIStreaming).toHaveBeenCalledTimes(1);
      expect(callbacks.callAPI).not.toHaveBeenCalled();
    });

    it('emits text_delta chunks via onTextDelta callback', async () => {
      // text deltas from callAPIStreaming wrapped as { type: "text_delta", text }
      const mockCallAPIStreaming = vi.fn(
        (_msgs, _tools, onTextDelta: (text: string) => void) => {
          onTextDelta('Hello');
          onTextDelta(', world');
          return Promise.resolve({
            content: 'Hello, world',
            usage: { input_tokens: 5, output_tokens: 3 },
          });
        }
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
      });
      const emitEvent = vi.fn<EmitEvent>();
      const chunks: unknown[] = [];
      const yieldChunk = vi.fn((chunk: unknown) => {
        chunks.push(chunk);
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Hi' }],
        {},
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      const textDeltaChunks = chunks.filter(
        (c) => (c as Record<string, unknown>)['type'] === 'text_delta'
      );
      expect(textDeltaChunks).toHaveLength(2);
      expect(textDeltaChunks[0]).toEqual({ type: 'text_delta', text: 'Hello' });
      expect(textDeltaChunks[1]).toEqual({
        type: 'text_delta',
        text: ', world',
      });
    });

    it('emits tool_call chunk before tool execution', async () => {
      // tool_call chunk emitted before executing each tool
      const toolImpl = vi.fn(() => 'tool result');
      const tools = { my_tool: createMockTool(toolImpl) };

      let callCount = 0;
      const mockCallAPIStreaming = vi.fn((_msgs, _tools, _onTextDelta) =>
        Promise.resolve({
          content: '',
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
        extractToolCalls: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return [{ id: 'c1', name: 'my_tool', input: { x: 42 } }];
          }
          return null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();
      const chunks: unknown[] = [];
      const yieldChunk = vi.fn((chunk: unknown) => {
        chunks.push(chunk);
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Go' }],
        tools,
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      const toolCallChunks = chunks.filter(
        (c) => (c as Record<string, unknown>)['type'] === 'tool_call'
      );
      expect(toolCallChunks).toHaveLength(1);
      expect(toolCallChunks[0]).toEqual({
        type: 'tool_call',
        name: 'my_tool',
        args: { x: 42 },
      });
    });

    it('emits tool_result chunk after tool execution', async () => {
      // tool_result chunk emitted after tool execution completes
      const toolImpl = vi.fn(() => 'computed result');
      const tools = { compute: createMockTool(toolImpl) };

      let callCount = 0;
      const mockCallAPIStreaming = vi.fn((_msgs, _tools, _onTextDelta) =>
        Promise.resolve({
          content: '',
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
        extractToolCalls: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return [{ id: 'c2', name: 'compute', input: {} }];
          }
          return null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();
      const chunks: unknown[] = [];
      const yieldChunk = vi.fn((chunk: unknown) => {
        chunks.push(chunk);
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Compute' }],
        tools,
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      const toolResultChunks = chunks.filter(
        (c) => (c as Record<string, unknown>)['type'] === 'tool_result'
      );
      expect(toolResultChunks).toHaveLength(1);
      expect(toolResultChunks[0]).toEqual({
        type: 'tool_result',
        name: 'compute',
        result: 'computed result',
      });
    });

    it('emits tool_call before tool_result in correct order within a turn', async () => {
      // order of emission within a single turn — tool_call precedes tool_result
      // The second turn also emits a text_delta (streaming fires onTextDelta each call),
      // so the full sequence is: text_delta, tool_call, tool_result, text_delta.
      const tools = { order_test: createMockTool(() => 'done') };

      let callCount = 0;
      const mockCallAPIStreaming = vi.fn(
        (_msgs, _tools, onTextDelta: (text: string) => void) => {
          onTextDelta('thinking...');
          return Promise.resolve({
            content: '',
            usage: { input_tokens: 5, output_tokens: 2 },
          });
        }
      );
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
        extractToolCalls: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            return [{ id: 'c3', name: 'order_test', input: { v: 1 } }];
          }
          return null;
        }),
      });
      const emitEvent = vi.fn<EmitEvent>();
      const chunkTypes: string[] = [];
      const yieldChunk = vi.fn((chunk: unknown) => {
        chunkTypes.push((chunk as Record<string, unknown>)['type'] as string);
      });

      await executeToolLoop(
        [{ role: 'user', content: 'Run' }],
        tools,
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      // First turn: text_delta → tool_call → tool_result
      // Second turn: text_delta (no more tool calls, loop ends)
      expect(chunkTypes[0]).toBe('text_delta');
      expect(chunkTypes[1]).toBe('tool_call');
      expect(chunkTypes[2]).toBe('tool_result');
      // tool_call always precedes tool_result
      const toolCallIdx = chunkTypes.indexOf('tool_call');
      const toolResultIdx = chunkTypes.indexOf('tool_result');
      expect(toolCallIdx).toBeLessThan(toolResultIdx);
    });

    it('falls back to callAPI when callAPIStreaming is not defined', async () => {
      // yieldChunk provided but callAPIStreaming absent → use callAPI
      const callbacks = createMockCallbacks(); // no callAPIStreaming
      const emitEvent = vi.fn<EmitEvent>();
      const yieldChunk = vi.fn<(chunk: RillValue) => void>();

      await executeToolLoop(
        [{ role: 'user', content: 'Hello' }],
        {},
        3,
        callbacks,
        emitEvent,
        10,
        undefined,
        yieldChunk
      );

      expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
    });
  });

  describe('streaming API failure', () => {
    it('wraps callAPIStreaming failure as RuntimeError RILL-R005', async () => {
      // provider streaming failure → RuntimeError RILL-R005
      const streamingError = new Error('stream connection lost');
      const mockCallAPIStreaming = vi.fn(() => Promise.reject(streamingError));
      const callbacks = createMockCallbacks({
        callAPIStreaming: mockCallAPIStreaming,
      });
      const emitEvent = vi.fn<EmitEvent>();
      const yieldChunk = vi.fn<(chunk: RillValue) => void>();

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Hello' }],
          {},
          3,
          callbacks,
          emitEvent,
          10,
          undefined,
          yieldChunk
        )
      ).rejects.toMatchObject({
        errorId: 'RILL-R005',
        message: expect.stringContaining('stream connection lost') as string,
      });
    });
  });
});

// ============================================================
// BUILD RESPONSE MESSAGES
// ============================================================

describe('buildResponseMessages', () => {
  it('returns array with single text part assistant message appended', () => {
    // appends {role:'assistant', parts:[...]} to input list
    const input = [
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Hello' }],
      },
    ];
    const result = buildResponseMessages(input, [
      { type: 'text', text: 'Hi there' },
    ]);
    expect(result).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] },
    ]);
  });

  it('works with empty input messages', () => {
    // empty input → single-element array with assistant message
    const result = buildResponseMessages([], [{ type: 'text', text: 'Hello' }]);
    expect(result).toEqual([
      { role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
    ]);
  });

  it('returns a new array instance (does not mutate input)', () => {
    // returned array is a new reference
    const input = [
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Hello' }],
      },
    ];
    const result = buildResponseMessages(input, [
      { type: 'text', text: 'Reply' },
    ]);
    expect(result).not.toBe(input);
    expect(result).toHaveLength(2);
    expect(input).toHaveLength(1);
  });

  it('preserves all input messages', () => {
    const input = [
      {
        role: 'system' as const,
        parts: [{ type: 'text' as const, text: 'You are helpful.' }],
      },
      {
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Question' }],
      },
      {
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Answer' }],
      },
    ];
    const result = buildResponseMessages(input, [
      { type: 'text', text: 'Final answer' },
    ]);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      role: 'system',
      parts: [{ type: 'text', text: 'You are helpful.' }],
    });
    expect(result[1]).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'Question' }],
    });
    expect(result[2]).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Answer' }],
    });
    expect(result[3]).toEqual({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Final answer' }],
    });
  });

  it('preserves multi-part assistant (thinking + text + tool_use)', () => {
    // multi-part assistant parts preserved exactly
    const parts = [
      { type: 'thinking' as const, text: 'Let me think...' },
      { type: 'text' as const, text: 'Here is my answer.' },
      {
        type: 'tool_use' as const,
        id: 'call_1',
        name: 'search',
        input: { query: 'test' },
      },
    ];
    const result = buildResponseMessages([], parts);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'assistant', parts });
  });
});
