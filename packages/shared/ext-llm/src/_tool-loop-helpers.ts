import { vi } from 'vitest';
import { callable, type RillValue } from '@rcrsr/rill';
import type { ToolLoopCallbacks } from './types.js';

export type EmitEvent = (event: string, data: Record<string, unknown>) => void;
export type ToolDescriptors = Parameters<ToolLoopCallbacks['buildTools']>[0];
export type ToolResults = Parameters<ToolLoopCallbacks['formatToolResult']>[0];

/**
 * Create a mock Rill callable function for testing
 */
export function createMockTool(
  implementation: (
    args: Record<string, RillValue>
  ) => RillValue | Promise<RillValue>,
  description?: string
): RillValue {
  const baseCallable = callable(implementation, false);
  if (description !== undefined) {
    (baseCallable as { annotations: Record<string, unknown> }).annotations[
      'description'
    ] = description;
  }
  return baseCallable;
}

/**
 * Create default tool loop callbacks with mock implementations
 */
export function createMockCallbacks(
  overrides?: Partial<ToolLoopCallbacks>
): ToolLoopCallbacks {
  const defaultCallbacks: ToolLoopCallbacks = {
    buildTools: vi.fn((tools: ToolDescriptors) => tools),
    callAPI: vi.fn(() =>
      Promise.resolve({
        content: 'response',
        usage: { input_tokens: 100, output_tokens: 50 },
      })
    ),
    extractToolCalls: vi.fn(() => null),
    formatAssistantMessage: vi.fn(() => ({ role: 'assistant', content: '' })),
    formatToolResult: vi.fn((results: ToolResults) => ({
      role: 'user',
      content: results,
    })),
  };

  return { ...defaultCallbacks, ...overrides };
}
