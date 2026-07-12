/**
 * Usage accumulator tests.
 * Covers AC-12, AC-29, IR-7.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';

// ============================================================
// MODULE MOCK
// ============================================================

const mockStream = vi.fn();
const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(
      status: number | undefined,
      _error: unknown,
      message: string,
      _headers: unknown
    ) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAzureOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

function validConfig(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    inference: {
      model: 'gpt-4o',
      apiVersion: '2025-01-01-preview',
    },
  };
}

/**
 * Build a mock stream runner that returns a final chat completion with token usage.
 */
function createMockStreamRunner(
  content: string,
  promptTokens: number,
  completionTokens: number
) {
  const finalCompletion = {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: 1234567890,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };

  async function* asyncChunks() {
    yield {
      choices: [{ delta: { content }, finish_reason: null, index: 0 }],
      id: finalCompletion.id,
      object: 'chat.completion.chunk',
      created: finalCompletion.created,
      model: finalCompletion.model,
    };
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/**
 * Resolve a RillStream by calling its internal resolve callback.
 */
async function resolveStream(stream: unknown): Promise<unknown> {
  return (
    stream as { __rill_stream_resolve: () => Promise<unknown> }
  ).__rill_stream_resolve();
}

// ============================================================
// TESTS
// ============================================================

describe('usage accumulator', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // AC-29: usage() returns zeros when no LLM calls have been made
  it('returns zero tokens initially (AC-29)', async () => {
    const { createFoundryExtension } = await import('../src/factory.js');
    const ext = await createFoundryExtension(validConfig());

    const value = ext.value as Record<
      string,
      { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
    >;
    const usageFn = value['usage']!;

    const result = usageFn.fn({}, {}) as Record<string, number>;

    expect(result['input_tokens']).toBe(0);
    expect(result['output_tokens']).toBe(0);
  });

  it('usage() result has both input_tokens and output_tokens fields (IR-7)', async () => {
    const { createFoundryExtension } = await import('../src/factory.js');
    const ext = await createFoundryExtension(validConfig());

    const value = ext.value as Record<
      string,
      { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
    >;
    const usageFn = value['usage']!;

    const result = usageFn.fn({}, {}) as Record<string, unknown>;

    expect(result).toHaveProperty('input_tokens');
    expect(result).toHaveProperty('output_tokens');
    expect(typeof result['input_tokens']).toBe('number');
    expect(typeof result['output_tokens']).toBe('number');
  });

  // AC-12: usage() returns non-zero token counts after LLM call
  it('accumulates tokens after a message() call (AC-12)', async () => {
    mockStream.mockReturnValue(createMockStreamRunner('Hello!', 15, 25));

    const { createFoundryExtension } = await import('../src/factory.js');
    const ext = await createFoundryExtension(validConfig());

    const ctx = createRuntimeContext({
      callbacks: { onLog: vi.fn(), onLogEvent: vi.fn() },
    });
    const value = ext.value as Record<
      string,
      { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
    >;

    // Trigger resolve to run the LLM call and accumulate usage
    const stream = value['message']!.fn({ prompt: 'Hi' }, ctx);
    await resolveStream(stream);

    const usageFn = value['usage']!;
    const result = usageFn.fn({}, {}) as Record<string, number>;

    expect(result['input_tokens']).toBe(15);
    expect(result['output_tokens']).toBe(25);
  });

  it('usage() accumulates tokens across multiple message() calls (AC-12)', async () => {
    mockStream
      .mockReturnValueOnce(createMockStreamRunner('First response', 10, 20))
      .mockReturnValueOnce(createMockStreamRunner('Second response', 5, 15));

    const { createFoundryExtension } = await import('../src/factory.js');
    const ext = await createFoundryExtension(validConfig());

    const ctx = createRuntimeContext({
      callbacks: { onLog: vi.fn(), onLogEvent: vi.fn() },
    });
    const value = ext.value as Record<
      string,
      { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
    >;

    // First call
    await resolveStream(value['message']!.fn({ prompt: 'First' }, ctx));
    // Second call
    await resolveStream(value['message']!.fn({ prompt: 'Second' }, ctx));

    const usageFn = value['usage']!;
    const result = usageFn.fn({}, {}) as Record<string, number>;

    expect(result['input_tokens']).toBe(15); // 10 + 5
    expect(result['output_tokens']).toBe(35); // 20 + 15
  });
});
