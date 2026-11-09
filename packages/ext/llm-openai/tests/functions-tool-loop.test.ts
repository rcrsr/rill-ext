/**
 * Function behavior tests for tool_loop()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt, expectThrowHalt } from './_halt-helpers.js';
import {
  createRuntimeContext,
  callable,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { OpenAIExtensionConfig } from '../src/types.js';
import {
  createMockFinalCompletion,
  getCallable,
  resolveStream,
  type StreamCursor,
} from './_functions-helpers.js';

// Mock the OpenAI SDK at module level
const mockCreate = vi.fn();
const mockStream = vi.fn();

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
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

/**
 * Create an ApplicationCallable with description and param metadata for tool_loop tests.
 */
function makeTool(
  fn: (args: Record<string, RillValue>) => RillValue | Promise<RillValue>,
  options?: {
    description?: string;
    params?: Array<{
      name: string;
      type: 'string' | 'number' | 'bool';
      description?: string;
    }>;
  }
): ApplicationCallable {
  const base = callable(fn);
  return {
    ...base,
    annotations:
      options?.description !== undefined
        ? { description: options.description }
        : base.annotations,
    params:
      options?.params?.map((p) => ({
        name: p.name,
        type: { kind: p.type },
        defaultValue: undefined,
        annotations:
          p.description !== undefined ? { description: p.description } : {},
      })) ?? base.params,
  };
}

/**
 * Build a mock stream runner for tool_loop scenarios.
 * The runner emits content deltas then resolves finalChatCompletion().
 * The `on` method captures registered event handlers.
 */
function createMockToolLoopRunner(
  textDeltas: string[],
  finalCompletion: ChatCompletion
) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  const runner = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return runner;
    }),
    finalChatCompletion: vi.fn(() => {
      // Fire content events before resolving
      for (const delta of textDeltas) {
        for (const h of handlers['content'] ?? []) {
          h(delta, delta);
        }
      }
      return Promise.resolve(finalCompletion);
    }),
    abort: vi.fn(),
  };

  return runner;
}

/**
 * Collect all dict chunks from a tool_loop RillStream.
 */
async function collectDictChunks(
  stream: unknown
): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  let current = stream as StreamCursor;
  while (!current.done) {
    const nextField = current.next as { fn?: unknown };
    const fn = nextField.fn ?? current.next;
    const fnToCall = (
      typeof fn === 'function' ? fn : (fn as { fn: unknown }).fn
    ) as (a: object, b: object) => Promise<StreamCursor>;
    current = await fnToCall({}, {});
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as Record<string, unknown>);
    }
  }
  return chunks;
}

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  // ============================================================
  // STREAMING RETURN (AC-7, AC-8, AC-9)
  // ============================================================

  describe('stream return (AC-7/AC-8/AC-9)', () => {
    // AC-8: Iterating tool_loop stream yields text_delta, tool_call, tool_result dicts
    it('iterating stream yields text_delta, tool_call, and tool_result chunks', async () => {
      // First turn: tool call response
      const toolCallCompletion = {
        id: 'chatcmpl-test1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      // Second turn: final response
      const finalCompletion = createMockFinalCompletion('The weather is sunny');

      const runner1 = createMockToolLoopRunner(
        ['Calling tool...'],
        toolCallCompletion
      );
      const runner2 = createMockToolLoopRunner(
        ['The weather is sunny'],
        finalCompletion
      );

      mockStream.mockReturnValueOnce(runner1).mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn().mockResolvedValue('Sunny, 72°F'), {
          description: 'Get weather',
          params: [
            { name: 'location', type: 'string', description: 'City name' },
          ],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools },
        ctx
      );

      const chunks = await collectDictChunks(stream);

      // Should contain text_delta, tool_call, tool_result, then text_delta from second turn
      const textDeltas = chunks.filter((c) => c['type'] === 'text_delta');
      const toolCalls = chunks.filter((c) => c['type'] === 'tool_call');
      const toolResults = chunks.filter((c) => c['type'] === 'tool_result');

      expect(textDeltas.length).toBeGreaterThan(0);
      expect(toolCalls.length).toBe(1);
      expect(toolResults.length).toBe(1);

      expect(toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'get_weather',
      });
      expect(toolResults[0]).toMatchObject({
        type: 'tool_result',
        name: 'get_weather',
      });
    });

    // AC-9: tool_loop()() resolution dict contains aggregated usage and turns
    it('resolve() returns final message text, model, usage, and stop_reason without calling tools', async () => {
      const runner = createMockToolLoopRunner(
        ['Final response'],
        createMockFinalCompletion('Final response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const toolFn = vi.fn().mockResolvedValue('result');
      const tools = {
        test_tool: makeTool(toolFn, {
          description: 'A test tool',
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test prompt', tools },
        ctx
      );
      const result = await resolveStream(stream);

      expect(toolFn).not.toHaveBeenCalled();
      const msgs1 = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      const last1 = msgs1.at(-1)!;
      const text1 = last1.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(text1).toBe('Final response');
      expect(result['model']).toBe('gpt-4-turbo');
      expect(result['usage']).toEqual({ input: 10, output: 20 });
      expect(result['stop_reason']).toBe('stop');
      expect(Array.isArray(msgs1)).toBe(true);
    });
  });

  describe('success cases', () => {
    // AC-25: tool_loop with max_turns:1 stops after 1 turn
    it('respects max_turns limit', async () => {
      // First call returns tool call (max_turns=1, loop exits after 1 turn)
      const runner = createMockToolLoopRunner([], {
        id: 'chatcmpl-test',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'test_tool', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        test_tool: makeTool(vi.fn().mockResolvedValue('tool result'), {
          description: 'A test tool',
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test prompt', tools, max_turns: 1 },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: 'max_turns' });
    });

    it('executes tool loop with tool calls', async () => {
      // First call: returns tool call response
      const runner1 = createMockToolLoopRunner([], {
        id: 'chatcmpl-test1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      // Second call: returns final response
      const runner2 = createMockToolLoopRunner([], {
        id: 'chatcmpl-test2',
        object: 'chat.completion' as const,
        created: 1234567891,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: 'The weather is sunny',
            },
            finish_reason: 'stop' as const,
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      });

      mockStream.mockReturnValueOnce(runner1).mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const mockToolFn = vi.fn().mockResolvedValue('Sunny, 72°F');

      const tools = {
        get_weather: makeTool(mockToolFn, {
          description: 'Get weather',
          params: [
            { name: 'location', type: 'string', description: 'City name' },
          ],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools },
        ctx
      );
      const result = await resolveStream(stream);

      const msgsWeather = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      const lastWeather = msgsWeather.at(-1)!;
      const textWeather = lastWeather.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(textWeather).toBe('The weather is sunny');
      expect(result['usage']).toEqual({ input: 30, output: 15 });
      expect(mockToolFn).toHaveBeenCalledWith({ location: 'NYC' }, ctx);
    });

    it('strips SDK-injected properties from assistant messages before next request', async () => {
      // First call: response includes SDK-injected `parsed` and `refusal` fields
      const runner1 = createMockToolLoopRunner([], {
        id: 'chatcmpl-test1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      // Second call: final response
      const runner2 = createMockToolLoopRunner(
        [],
        createMockFinalCompletion('The weather is sunny')
      );

      mockStream.mockReturnValueOnce(runner1).mockReturnValueOnce(runner2);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(vi.fn().mockResolvedValue('Sunny, 72°F'), {
          description: 'Get weather',
          params: [
            { name: 'location', type: 'string', description: 'City name' },
          ],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather?', tools },
        ctx
      );
      await resolveStream(stream);

      // Inspect the messages sent in the second API call
      const secondCallArgs = mockStream.mock.calls[1]![0] as {
        messages: Array<Record<string, unknown>>;
      };
      const assistantMsg = secondCallArgs.messages.find(
        (m: Record<string, unknown>) => m['role'] === 'assistant'
      );

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg).not.toHaveProperty('parsed');
      expect(assistantMsg).not.toHaveProperty('refusal');
      expect(assistantMsg).toHaveProperty('role', 'assistant');
      expect(assistantMsg).toHaveProperty('tool_calls');
    });
  });

  describe('error cases', () => {
    // EC-20: Empty prompt — throws synchronously before stream creation
    it('throws RuntimeError for empty prompt', () => {
      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        some_tool: makeTool(vi.fn(), { description: 'A test tool' }),
      };
      expectThrowHalt(
        () => getCallable(ext, 'tool_loop').fn({ prompt: '', tools }, ctx),
        { message: 'prompt string cannot be empty' }
      );
    });

    // EC-4: Streaming API failure — resolve rejects with a halt containing the API error message
    it('resolve rejects with RILL-R005 on streaming API failure [EC-4]', async () => {
      // Use a runner that has .on but fails on finalChatCompletion to simulate API error
      const failingRunner = {
        on: vi.fn().mockReturnThis(),
        finalChatCompletion: vi.fn().mockRejectedValue(new Error('API error')),
        abort: vi.fn(),
      };
      mockStream.mockReturnValue(failingRunner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        tool: makeTool(vi.fn().mockResolvedValue('result'), {
          description: 'A test tool',
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test', tools },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), {
        message: expect.stringContaining('API error'),
      });
    });

    // AC-17: Tool execution error mid-loop yields tool_call chunk; stream resolves with final content
    it('tool_call chunk is yielded when tool errors; stream resolves with final content [AC-17]', async () => {
      // Turn 1: LLM calls a tool that will fail
      const toolCallCompletion = {
        id: 'chatcmpl-1',
        object: 'chat.completion' as const,
        created: 1234567890,
        model: 'gpt-4-turbo',
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant' as const,
              refusal: null,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'flaky_tool', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      // Turn 2: LLM recovers and gives final text response
      const finalCompletion = createMockFinalCompletion(
        'Recovered from tool error.'
      );

      mockStream
        .mockReturnValueOnce(createMockToolLoopRunner([], toolCallCompletion))
        .mockReturnValueOnce(
          createMockToolLoopRunner(
            ['Recovered from tool error.'],
            finalCompletion
          )
        );

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const ctx = createRuntimeContext();

      const tools = {
        flaky_tool: makeTool(
          vi.fn().mockRejectedValue(new Error('Transient failure')),
          { description: 'Flaky tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'test', tools },
        ctx
      );

      const chunks = await collectDictChunks(stream);

      // tool_call chunk is yielded for the failing tool
      const toolCallChunks = chunks.filter((c) => c['type'] === 'tool_call');
      expect(toolCallChunks.length).toBeGreaterThan(0);

      // Stream resolves with final content after tool error
      const result = await resolveStream(stream);
      const msgsRecov = result['messages'] as Array<{
        role: string;
        parts: Array<{ type: string; text: string }>;
      }>;
      const lastRecov = msgsRecov.at(-1)!;
      const textRecov = lastRecov.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(textRecov).toBe('Recovered from tool error.');
    });
  });
});
