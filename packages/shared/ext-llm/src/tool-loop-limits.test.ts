/**
 * Unit tests for tool loop orchestration: limits
 */

import { describe, it, expect, vi } from 'vitest';
import { executeToolLoop } from './tool-loop.js';
import {
  createMockTool,
  createMockCallbacks,
  type EmitEvent,
} from './_tool-loop-helpers.js';

// ============================================================
// MAX_TURNS RESOLUTION (§Defaults & Nullability)
// ============================================================

describe('executeToolLoop max_turns resolution', () => {
  // Creates a callbacks that always returns a tool call on turn 1, then stops
  function createTurnCountingCallbacks(_maxApiCalls = 100) {
    let apiCalls = 0;
    return createMockCallbacks({
      extractToolCalls: vi.fn(() => {
        apiCalls++;
        return apiCalls === 1
          ? [{ id: 'call_1', name: 'tool', input: {} }]
          : null;
      }),
    });
  }

  // Creates callbacks that always returns a tool call (to keep the loop running)
  function createInfiniteToolCallbacks() {
    return createMockCallbacks({
      extractToolCalls: vi.fn(() => [
        { id: 'call_1', name: 'tool', input: {} },
      ]),
    });
  }

  it('per-call maxTurns > 0 is used as the limit', async () => {
    // Resolution: per-call 5 overrides factory default
    const callbacks = createInfiniteToolCallbacks();
    const tools = { tool: createMockTool(() => 'ok') };

    await expect(
      executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>(),
        5, // per-call maxTurns = 5
        undefined,
        undefined,
        undefined,
        10 // factoryMaxTurns = 10 (should NOT be used)
      )
    ).rejects.toThrow('tool_loop exceeded max_turns (5)');
    // extractToolCalls is called 5 times (5 turns)
    expect(callbacks.extractToolCalls).toHaveBeenCalledTimes(5);
  });

  it.each([{ factoryMaxTurns: 3 }, { factoryMaxTurns: 7 }])(
    'per-call maxTurns = 0 routes to factoryMaxTurns $factoryMaxTurns',
    async ({ factoryMaxTurns }) => {
      // Resolution: per-call 0 (sentinel) → factory limit
      const callbacks = createInfiniteToolCallbacks();
      const tools = { tool: createMockTool(() => 'ok') };

      await expect(
        executeToolLoop(
          [{ role: 'user', content: 'Test' }],
          tools,
          3,
          callbacks,
          vi.fn<EmitEvent>(),
          0, // per-call sentinel
          undefined,
          undefined,
          undefined,
          factoryMaxTurns
        )
      ).rejects.toThrow(`tool_loop exceeded max_turns (${factoryMaxTurns})`);
      expect(callbacks.extractToolCalls).toHaveBeenCalledTimes(factoryMaxTurns);
    }
  );

  it('per-call maxTurns = 0 and factoryMaxTurns undefined → unlimited (no early halt)', async () => {
    // Resolution: 0 + undefined → unlimited; loop completes normally after tool returns no more calls
    const callbacks = createTurnCountingCallbacks();
    const tools = { tool: createMockTool(() => 'ok') };

    const result = await executeToolLoop(
      [{ role: 'user', content: 'Test' }],
      tools,
      3,
      callbacks,
      vi.fn<EmitEvent>(),
      0 // per-call sentinel; no factoryMaxTurns
    );

    // Loop should complete: 1 turn with tool call, 1 turn with no tool calls
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.result).toBe('ok');
  });

  it('negative per-call maxTurns is rejected with INVALID_INPUT', async () => {
    // Defensive guard: negative per-call value is invalid
    const callbacks = createMockCallbacks({});
    const tools = { tool: createMockTool(() => 'ok') };

    await expect(
      executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        3,
        callbacks,
        vi.fn<EmitEvent>(),
        -1 // negative per-call
      )
    ).rejects.toThrow('max_turns must be >= 0, got -1');
  });
});

// ============================================================
// MAX_ERRORS_EXCEEDED
// ============================================================

describe('executeToolLoop max_errors_exceeded', () => {
  it('uses default max_errors of 3 when maxErrors param is 0', async () => {
    // max_errors default: 3 when unset/0
    let errorCount = 0;
    const tools = {
      failing_tool: createMockTool(() => {
        errorCount++;
        throw new Error('Tool failed');
      }),
    };

    let apiCallCount = 0;
    const callbacks = createMockCallbacks({
      extractToolCalls: vi.fn(() => {
        apiCallCount++;
        return apiCallCount === 1
          ? [
              { id: 'call_1', name: 'failing_tool', input: {} },
              { id: 'call_2', name: 'failing_tool', input: {} },
              { id: 'call_3', name: 'failing_tool', input: {} },
              { id: 'call_4', name: 'failing_tool', input: {} },
            ]
          : null;
      }),
    });

    await expect(
      executeToolLoop(
        [{ role: 'user', content: 'Test' }],
        tools,
        0, // 0 → defaults to 3 internally
        callbacks,
        vi.fn<EmitEvent>()
      )
    ).rejects.toThrow('Tool execution failed: 3 consecutive errors');

    // Should stop at 3 errors (the default)
    expect(errorCount).toBe(3);
  });
});
