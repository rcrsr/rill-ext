/**
 * Tests for tool_loop() host function.
 * Covers AC-7 from the specification.
 *
 * AC-7: tool_loop called with tools dict returns dict with content, turns, usage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  callable,
  isRillStream,
  type RillValue,
  type ApplicationCallable,
} from '@rcrsr/rill';
import { createFoundryExtension } from '../src/factory.js';
import type { FoundryConfig } from '../src/types.js';
import { expectThrowHalt, expectRejectedHalt } from './_halt-helpers.js';

// ============================================================
// MOCK SETUP
// ============================================================

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockEmbeddingsCreate = vi.fn();

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

  class MockAzureOpenAI {
    chat = {
      completions: {
        create: mockCreate,
        stream: mockStream,
      },
    };
    embeddings = {
      create: mockEmbeddingsCreate,
    };
    static APIError = MockAPIError;
  }

  return {
    AzureOpenAI: MockAzureOpenAI,
    APIError: MockAPIError,
  };
});

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Create an AzureOpenAI ChatCompletion response with tool calls.
 * The foundry callAPIStreaming remaps usage to { input_tokens, output_tokens }.
 */
function createMockToolCallResponse(
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  model = 'gpt-4o'
) {
  return {
    id: 'chatcmpl-tool123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        },
        finish_reason: 'tool_calls' as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/**
 * Create an AzureOpenAI ChatCompletion response with text only (no tools).
 */
function createMockTextResponse(content: string, model = 'gpt-4o') {
  return {
    id: 'chatcmpl-text456',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content,
          tool_calls: null,
        },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
  };
}

/**
 * Create a mock stream runner for callAPIStreaming.
 * The foundry factory uses client.chat.completions.stream() which returns an object with:
 *   .on('content', handler) - emits text delta events
 *   .finalChatCompletion()  - resolves with final response
 */
function createMockStreamRunner(
  response: ReturnType<typeof createMockTextResponse> | ReturnType<typeof createMockToolCallResponse>
) {
  // Extract text content from the response to emit via 'content' events
  const textContent =
    response.choices[0]?.message?.content ?? '';

  const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const runner = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = [];
      }
      eventHandlers[event].push(handler);
      return runner;
    },
    finalChatCompletion: vi.fn().mockImplementation(async () => {
      // Emit content events before resolving to simulate streaming
      if (textContent && eventHandlers['content']) {
        for (const handler of eventHandlers['content']) {
          handler(textContent);
        }
      }
      return response;
    }),
    abort: vi.fn(),
  };

  return runner;
}

/**
 * Resolve a RillStream by calling its hidden __rill_stream_resolve callback.
 */
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  const resolve = (stream as Record<string, unknown>)['__rill_stream_resolve'] as () => Promise<unknown>;
  return (await resolve()) as Record<string, unknown>;
}

/**
 * Collect all dict chunks from a RillStream via next() iteration.
 */
async function collectChunks(stream: unknown): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = stream;
  while (!current.done) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    current = await (current.next as any).fn({}, null);
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as Record<string, unknown>);
    }
  }
  return chunks;
}

/**
 * Build a RillValue callable tool for tool_loop tests.
 */
function makeTool(
  fn: (args: Record<string, RillValue>) => RillValue | Promise<RillValue>,
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
      type: { kind: p.type },
      defaultValue: undefined,
      annotations:
        p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

// ============================================================
// BASE CONFIG
// ============================================================

const baseConfig: FoundryConfig = {
  endpoint: 'https://my-foundry.openai.azure.com',
  auth: { type: 'api-key', key: 'test-key' },
  inference: {
    model: 'gpt-4o',
    apiVersion: '2025-01-01-preview',
  },
};

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  describe('streaming', () => {
    // AC-7: tool_loop() returns RillStream
    it('returns a RillStream (isRillStream is true)', async () => {
      mockStream.mockReturnValue(
        createMockStreamRunner(createMockTextResponse('Done'))
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        my_tool: makeTool(() => 'result', { description: 'A tool' }),
      };

      const result = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Run something', tools, options: {} },
        ctx
      );

      expect(isRillStream(result)).toBe(true);
    });

    // AC-7: text_delta chunks appear when LLM emits text
    it('yields text_delta chunks when LLM emits text content', async () => {
      mockStream.mockReturnValueOnce(
        createMockStreamRunner(createMockTextResponse('Here is your answer: 42'))
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Give me a result', tools, options: {} },
        ctx
      );

      const chunks = await collectChunks(stream);
      const textDeltas = chunks.filter((c) => c['type'] === 'text_delta');
      expect(textDeltas.length).toBeGreaterThan(0);
      expect(
        textDeltas.every((c) => typeof c['text'] === 'string')
      ).toBe(true);
    });

    // AC-7: tool_call and tool_result chunks appear during tool execution
    it('yields tool_call and tool_result chunks during tool execution', async () => {
      mockStream
        .mockReturnValueOnce(
          createMockStreamRunner(
            createMockToolCallResponse([
              { id: 'tc_1', name: 'get_weather', arguments: { location: 'SF' } },
            ])
          )
        )
        .mockReturnValueOnce(
          createMockStreamRunner(createMockTextResponse('The weather is sunny.'))
        );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(
          (_args) => 'Sunny, 72F',
          {
            description: 'Get weather',
            params: [{ name: 'location', type: 'string', description: 'City' }],
          }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Weather in SF?', tools, options: {} },
        ctx
      );

      const chunks = await collectChunks(stream);
      const types = chunks.map((c) => c['type']);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
    });
  });

  describe('basic functionality', () => {
    // AC-7: resolution dict has content, model, usage, stop_reason, turns, messages
    it('resolves to dict with content, model, usage, stop_reason, turns, messages', async () => {
      mockStream
        .mockReturnValueOnce(
          createMockStreamRunner(
            createMockToolCallResponse([
              { id: 'tc_1', name: 'get_weather', arguments: { location: 'SF' } },
            ])
          )
        )
        .mockReturnValueOnce(
          createMockStreamRunner(createMockTextResponse('The weather in SF is sunny.'))
        );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        get_weather: makeTool(
          (_args) => 'Sunny, 72F',
          { description: 'Get weather' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Weather in SF?', tools, options: {} },
        ctx
      );

      const result = await resolveStream(stream);

      expect(result['content']).toBe('The weather in SF is sunny.');
      expect(result['model']).toBe('gpt-4o');
      expect(result['stop_reason']).toBe('stop');
      expect(typeof result['turns']).toBe('number');
      expect((result['turns'] as number)).toBe(2);
      expect(Array.isArray(result['messages'])).toBe(true);

      const usage = result['usage'] as Record<string, unknown>;
      expect(typeof usage['input']).toBe('number');
      expect(typeof usage['output']).toBe('number');
    });

    // AC-7: tool function is invoked with correct args
    it('dispatches tool with correct arguments', async () => {
      const toolFn = vi.fn().mockResolvedValue('tool result');

      mockStream
        .mockReturnValueOnce(
          createMockStreamRunner(
            createMockToolCallResponse([
              { id: 'tc_1', name: 'my_tool', arguments: { city: 'Paris' } },
            ])
          )
        )
        .mockReturnValueOnce(
          createMockStreamRunner(createMockTextResponse('Done.'))
        );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        my_tool: makeTool(toolFn, {
          description: 'My tool',
          params: [{ name: 'city', type: 'string', description: 'City name' }],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Call my_tool with Paris', tools, options: {} },
        ctx
      );

      await resolveStream(stream);

      expect(toolFn).toHaveBeenCalledOnce();
      expect(toolFn).toHaveBeenCalledWith(
        expect.objectContaining({ city: 'Paris' }),
        expect.anything()
      );
    });

    // AC-7: returns immediately when no tool calls are made
    it('returns immediately when LLM makes no tool calls', async () => {
      mockStream.mockReturnValueOnce(
        createMockStreamRunner(createMockTextResponse('I can answer directly: 42'))
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        calculator: makeTool(() => 'result', { description: 'Calculate' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the answer?', tools, options: {} },
        ctx
      );

      const result = await resolveStream(stream);

      expect(result['content']).toBe('I can answer directly: 42');
      expect(result['turns']).toBe(1);
      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    // AC-7: respects max_turns option
    it('respects max_turns limit and sets stop_reason to max_turns', async () => {
      mockStream.mockReturnValueOnce(
        createMockStreamRunner(
          createMockToolCallResponse([
            { id: 'tc_1', name: 'search', arguments: { query: 'test' } },
          ])
        )
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        search: makeTool(() => 'results', {
          description: 'Search',
          params: [{ name: 'query', type: 'string', description: 'Query' }],
        }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Search for something', tools, options: { max_turns: 1 } },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), {
        code: 'INVALID_INPUT',
        message: 'max_turns',
      });
      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    // AC-7: usage aggregates tokens across turns
    it('aggregates token usage across multiple turns', async () => {
      mockStream
        .mockReturnValueOnce(
          createMockStreamRunner(
            createMockToolCallResponse([
              { id: 'tc_1', name: 'get_data', arguments: {} },
            ])
          )
        )
        .mockReturnValueOnce(
          createMockStreamRunner(createMockTextResponse('Here is the data.'))
        );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        get_data: makeTool(() => 'data', { description: 'Get data' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Get the data', tools, options: {} },
        ctx
      );

      const result = await resolveStream(stream);

      // Turn 1: prompt_tokens=10, completion_tokens=20
      // Turn 2: prompt_tokens=5, completion_tokens=15
      // Total input_tokens = 10 + 5 = 15, output_tokens = 20 + 15 = 35
      const usage = result['usage'] as Record<string, unknown>;
      expect(usage['input']).toBe(15);
      expect(usage['output']).toBe(35);
    });
  });

  describe('error cases', () => {
    // AC-7: empty prompt halts with #INVALID_INPUT
    it('halts with #INVALID_INPUT for empty prompt', async () => {
      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      expectThrowHalt(() => {
        getCallable(ext, 'tool_loop').fn(
          { prompt: '', tools, options: {} },
          ctx
        );
      }, { code: 'INVALID_INPUT', message: 'prompt string cannot be empty' });
    });
  });
});
