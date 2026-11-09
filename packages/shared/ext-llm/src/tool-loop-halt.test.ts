/**
 * Unit tests for tool loop orchestration: halt
 */

import { describe, it, expect, vi } from 'vitest';
import {
  RuntimeHaltSignal,
  createRuntimeContext,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { executeToolLoop } from './tool-loop.js';
import {
  createMockTool,
  createMockCallbacks,
  type EmitEvent,
} from './_tool-loop-helpers.js';

// ============================================================
// TOOL HALT PROPAGATION
// ============================================================

describe('executeToolLoop tool halt propagation', () => {
  function createHaltValue(): RillValue {
    return createRuntimeContext().invalidate(new Error('policy refusal'), {
      code: 'FORBIDDEN',
      provider: 'test',
      raw: { kind: 'policy_refusal' },
    });
  }

  function createSingleCallCallbacks() {
    let extractCount = 0;
    return createMockCallbacks({
      extractToolCalls: vi.fn(() => {
        extractCount++;
        return extractCount === 1
          ? [{ id: 'call_1', name: 'halting_tool', input: {} }]
          : null;
      }),
    });
  }

  it('rejects with the original halt when a tool throws a non-catchable halt', async () => {
    const halt = new RuntimeHaltSignal(createHaltValue(), false);
    const toolFn = vi.fn((): RillValue => {
      throw halt;
    });
    const callbacks = createSingleCallCallbacks();

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { halting_tool: createMockTool(toolFn) },
      3,
      callbacks,
      vi.fn<EmitEvent>()
    ).catch((error: unknown) => error);

    expect(rejection).toBe(halt);
    expect((rejection as RuntimeHaltSignal).catchable).toBe(false);
    expect(getStatus((rejection as RuntimeHaltSignal).value).code).toEqual(
      expect.objectContaining({ name: 'FORBIDDEN' })
    );
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
  });

  it('rejects with the original halt when maxErrors is 1', async () => {
    const halt = new RuntimeHaltSignal(createHaltValue(), false);
    const toolFn = vi.fn((): RillValue => {
      throw halt;
    });
    const callbacks = createSingleCallCallbacks();

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { halting_tool: createMockTool(toolFn) },
      1,
      callbacks,
      vi.fn<EmitEvent>()
    ).catch((error: unknown) => error);

    expect(rejection).toBe(halt);
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
  });

  it('rejects with a DISPOSED halt and emits a terminal tool_result event', async () => {
    const disposedValue = createRuntimeContext().invalidate(
      new Error('disposed'),
      {
        code: 'DISPOSED',
        provider: 'test',
        raw: { kind: 'extension_disposed' },
      }
    );
    const halt = new RuntimeHaltSignal(disposedValue, false);
    const toolFn = vi.fn((): RillValue => {
      throw halt;
    });
    const emitEvent = vi.fn<EmitEvent>();

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { halting_tool: createMockTool(toolFn) },
      3,
      createSingleCallCallbacks(),
      emitEvent
    ).catch((error: unknown) => error);

    expect(rejection).toBe(halt);
    expect(getStatus((rejection as RuntimeHaltSignal).value).code).toEqual(
      expect.objectContaining({ name: 'DISPOSED' })
    );
    expect(emitEvent).toHaveBeenCalledWith(
      'tool_result',
      expect.objectContaining({
        tool_name: 'halting_tool',
        error: expect.any(String) as string,
        duration: expect.any(Number) as number,
      })
    );
  });

  it('rejects with a catchable DISPOSED halt without retrying the tool', async () => {
    const disposedValue = createRuntimeContext().invalidate(
      new Error('disposed'),
      {
        code: 'DISPOSED',
        provider: 'test',
        raw: { kind: 'extension_disposed' },
      }
    );
    const halt = new RuntimeHaltSignal(disposedValue, true);
    const toolFn = vi.fn((): RillValue => {
      throw halt;
    });
    const callbacks = createSingleCallCallbacks();
    const emitEvent = vi.fn<EmitEvent>();

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { halting_tool: createMockTool(toolFn) },
      3,
      callbacks,
      emitEvent
    ).catch((error: unknown) => error);

    expect(rejection).toBe(halt);
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(callbacks.callAPI).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(
      'tool_result',
      expect.objectContaining({ tool_name: 'halting_tool' })
    );
  });

  it('converts a catchable halt into a tool error result and continues', async () => {
    const halt = new RuntimeHaltSignal(createHaltValue(), true);
    const toolFn = vi.fn((): RillValue => {
      throw halt;
    });
    const callbacks = createSingleCallCallbacks();

    await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { halting_tool: createMockTool(toolFn) },
      3,
      callbacks,
      vi.fn<EmitEvent>()
    );

    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(callbacks.callAPI).toHaveBeenCalledTimes(2);
    expect(callbacks.formatToolResult).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'call_1',
        name: 'halting_tool',
        error: expect.stringContaining('policy refusal') as string,
      }),
    ]);
  });
});

describe('executeToolLoop cancellation mid-turn', () => {
  function cancelledKind(rejection: unknown): unknown {
    expect(rejection).toBeInstanceOf(RuntimeHaltSignal);
    return getStatus((rejection as RuntimeHaltSignal).value).raw?.['kind'];
  }

  it('invokes no tool when the signal aborts during the API call', async () => {
    const controller = new AbortController();
    const toolFn = vi.fn((): RillValue => 'ok');
    const callbacks = createMockCallbacks({
      callAPI: vi.fn(() => {
        controller.abort();
        return Promise.resolve({ content: 'x' });
      }),
      extractToolCalls: vi.fn(() => [
        { id: 'call_1', name: 'tool_a', input: {} },
      ]),
    });

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { tool_a: createMockTool(toolFn) },
      3,
      callbacks,
      vi.fn<EmitEvent>(),
      undefined,
      createRuntimeContext(),
      undefined,
      controller.signal
    ).catch((error: unknown) => error);

    expect(cancelledKind(rejection)).toBe('tool_loop_cancelled');
    expect(toolFn).not.toHaveBeenCalled();
  });

  it('reports tool_loop_cancelled when callAPI fails with a non-abort error while the signal is aborted', async () => {
    const controller = new AbortController();
    const callbacks = createMockCallbacks({
      callAPI: vi.fn(() => {
        controller.abort();
        return Promise.reject(new Error('some vendor error'));
      }),
      detectError: () => ({ message: 'vendor' }),
    });

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      {},
      3,
      callbacks,
      vi.fn<EmitEvent>(),
      undefined,
      createRuntimeContext(),
      undefined,
      controller.signal
    ).catch((error: unknown) => error);

    expect(cancelledKind(rejection)).toBe('tool_loop_cancelled');
  });

  it('returns a completed final response even when the signal aborted during the API call', async () => {
    const controller = new AbortController();
    const callbacks = createMockCallbacks({
      callAPI: vi.fn(() => {
        controller.abort();
        return Promise.resolve({ content: 'final' });
      }),
    });

    const result = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      {},
      3,
      callbacks,
      vi.fn<EmitEvent>(),
      undefined,
      createRuntimeContext(),
      undefined,
      controller.signal
    );

    expect(result.toolCalls).toEqual([]);
  });

  it('invokes no further tool when the signal aborts between tool calls', async () => {
    const controller = new AbortController();
    const firstTool = vi.fn((): RillValue => {
      controller.abort();
      return 'ok';
    });
    const secondTool = vi.fn((): RillValue => 'ok');
    const callbacks = createMockCallbacks({
      extractToolCalls: vi.fn(() => [
        { id: 'call_1', name: 'tool_a', input: {} },
        { id: 'call_2', name: 'tool_b', input: {} },
      ]),
    });

    const rejection: unknown = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      { tool_a: createMockTool(firstTool), tool_b: createMockTool(secondTool) },
      3,
      callbacks,
      vi.fn<EmitEvent>(),
      undefined,
      createRuntimeContext(),
      undefined,
      controller.signal
    ).catch((error: unknown) => error);

    expect(cancelledKind(rejection)).toBe('tool_loop_cancelled');
    expect(firstTool).toHaveBeenCalledTimes(1);
    expect(secondTool).not.toHaveBeenCalled();
  });
});
