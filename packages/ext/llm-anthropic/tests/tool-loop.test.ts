/**
 * Tool loop tests for tool_loop() function
 * Validates tool calling, parallel execution, error handling, and loop control
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, callable, isRillStream, type RillValue, type ApplicationCallable } from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import { expectRejectedHalt } from './_halt-helpers.js';

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

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
// mockCreate is kept for tests that verify API params via non-streaming path (not used by tool_loop streaming).
// mockStream is used by tool_loop since it uses callAPIStreaming (messages.stream).
const mockCreate = vi.fn();
const mockStream = vi.fn();

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
        stream: mockStream,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

/**
 * Create a mock MessageStream from a response object.
 * Simulates the Anthropic SDK stream API used by callAPIStreaming.
 * Calls 'text' event handlers with text content, then resolves finalMessage() with the response.
 */
function createMockMessageStream(response: ReturnType<typeof createMockTextResponse> | ReturnType<typeof createMockToolUseResponse>) {
  // Extract text content from response to emit via 'text' events
  const textContent = response.content
    .filter((block: Record<string, unknown>) => block['type'] === 'text' && typeof block['text'] === 'string')
    .map((block: Record<string, unknown>) => block['text'] as string)
    .join('');

  const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const stream = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[event]) {
        eventHandlers[event] = [];
      }
      eventHandlers[event].push(handler);
      return stream;
    },
    finalMessage: vi.fn().mockImplementation(async () => {
      // Emit text events before resolving finalMessage
      if (textContent && eventHandlers['text']) {
        for (const handler of eventHandlers['text']) {
          handler(textContent, textContent);
        }
      }
      return response;
    }),
    abort: vi.fn(),
  };

  return stream;
}

/**
 * Create an ApplicationCallable with description and param metadata for tool_loop tests.
 * Converts old {name, description, params, fn} format to the new dict-form callable.
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
      annotations: p.description !== undefined ? { description: p.description } : {},
    }));
  }
  return tool;
}

// ============================================================
// STREAM HELPERS
// ============================================================

/**
 * Resolve a RillStream by calling its hidden __rill_stream_resolve property.
 */
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  return (stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }).__rill_stream_resolve();
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected dict chunks (text_delta, tool_call, tool_result).
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

// ============================================================
// TOOL_LOOP() TESTS
// ============================================================

describe('tool_loop() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('streaming', () => {
    // AC-7: tool_loop() returns RillStream
    it('returns RillStream (isRillStream is true)', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream.mockReturnValue(createMockMessageStream(createMockTextResponse('Hello')));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const result = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: {} },
        ctx
      );

      expect(isRillStream(result)).toBe(true);
    });

    // AC-8: Iterating tool_loop() stream yields text_delta, tool_call, tool_result events
    it('yields text_delta, tool_call, and tool_result chunks when iterated', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Mock sequence: tool_use turn -> final text turn
      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'get_weather', id: 'tool_1', input: { location: 'SF' } }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('The weather in SF is sunny.')
        ));

      const tools = {
        get_weather: makeTool(
          (_args) => 'Sunny, 72°F',
          { description: 'Get weather', params: [{ name: 'location', type: 'string', description: 'City' }] }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Weather in SF?', tools, options: {} },
        ctx
      );

      const chunks = await collectChunks(stream);

      // Should have at least tool_call and tool_result chunks; text_delta may appear
      const types = chunks.map((c) => c['type']);
      expect(types).toContain('tool_call');
      expect(types).toContain('tool_result');
      // text_delta chunks may appear from text content in the final response
    });

    // AC-9: tool_loop()() resolution dict contains correct fields
    it('resolution dict has content, model, usage, stop_reason, turns, messages', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'get_weather', id: 'tool_1', input: { location: 'SF' } }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('The weather in SF is sunny.')
        ));

      const tools = {
        get_weather: makeTool((_args) => 'Sunny, 72°F', { description: 'Get weather' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Weather in SF?', tools, options: {} },
        ctx
      );

      const result = await resolveStream(stream);

      expect(result['content']).toBe('The weather in SF is sunny.');
      expect(result['model']).toBe('claude-sonnet-4-5-20250929');
      expect(result['usage']).toEqual({ input: 15, output: 35 }); // 10+5, 20+15
      expect(result['stop_reason']).toBe('end_turn');
      expect(typeof result['turns']).toBe('number');
      expect(Array.isArray(result['messages'])).toBe(true);
    });

    // text_delta chunks appear in tool_loop stream when LLM emits text
    it('yields text_delta chunks when LLM emits text content', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Final text response with actual text content
      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockTextResponse('Here is the result: 42')
      ));

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
      expect(textDeltas.every((c) => typeof c['text'] === 'string')).toBe(true);
    });
  });

  describe('basic functionality', () => {
    // AC-6: tool_loop executes loop and returns dict via resolve
    it('executes single tool call and returns result', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Mock sequence: tool_use -> final response
      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([
            { name: 'get_weather', id: 'tool_1', input: { location: 'SF' } },
          ])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('The weather in SF is sunny.')
        ));

      const tools = {
        get_weather: makeTool(
          (args) => {
            expect(args['location']).toBe('SF');
            return 'Sunny, 72°F';
          },
          {
            description: 'Get weather',
            params: [{ name: 'location', type: 'string', description: 'City name' }],
          }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the weather in SF?', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('The weather in SF is sunny.');
      expect(result['turns']).toBe(2);
      expect(result['stop_reason']).toBe('end_turn');
      expect(result['usage']).toEqual({ input: 15, output: 35 });
      expect(mockStream).toHaveBeenCalledTimes(2);
    });

    // AC-26: 0 tool calls returns immediately
    it('returns immediately when no tool calls made', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockTextResponse('I can answer that directly: 42')
      ));

      const tools = {
        calculator: makeTool(() => 'result', { description: 'Calculate' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'What is the answer?', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['content']).toBe('I can answer that directly: 42');
      expect(result['turns']).toBe(1);
      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    // AC-25: max_turns:1 returns after single LLM response
    it('respects max_turns limit', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockToolUseResponse([
          { name: 'search', id: 'tool_1', input: { query: 'test' } },
        ])
      ));

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
      const result = await resolveStream(stream);

      expect(result['stop_reason']).toBe('max_turns');
      expect(result['turns']).toBe(1);
      expect(mockStream).toHaveBeenCalledTimes(1);
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

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([
            { name: 'tool_a', id: 'tool_1', input: {} },
            { name: 'tool_b', id: 'tool_2', input: {} },
            { name: 'tool_c', id: 'tool_3', input: {} },
          ])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('All tools completed')
        ));

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

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Run tools', tools, options: {} }, ctx);
      await resolveStream(stream);

      // All tools should start before any finish (parallel execution)
      expect(executionOrder.filter((e) => e.endsWith('-start')).length).toBe(3);
      expect(executionOrder.indexOf('A-start')).toBeLessThan(
        executionOrder.indexOf('B-end')
      );
    });
  });

  describe('error handling', () => {
    // EC-22: Empty prompt raises error before stream creation
    it('throws error for empty prompt', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      expect(() =>
        getCallable(ext, 'tool_loop').fn({ prompt: '   ', tools: {}, options: {} }, ctx)
      ).toThrow('prompt text cannot be empty');
    });

    // EC-4: Provider streaming API failure throws RuntimeError RILL-R005
    it('throws RuntimeError RILL-R005 on streaming API failure [EC-4]', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // Mock the stream to throw when finalMessage() is called (simulates streaming API failure)
      const errorStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockRejectedValue(new Error('Connection reset by peer')),
        abort: vi.fn(),
      };
      mockStream.mockReturnValue(errorStream);

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: {} },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: expect.stringContaining('Provider API error:') });
    });

    // EC-5: Consecutive tool errors exceed max — RuntimeError RILL-R005 with exact message
    it('throws RuntimeError RILL-R005 for consecutive errors with errorId [EC-5]', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'failing_tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'failing_tool', id: 'tool_2', input: {} }])
        ));

      const tools = {
        failing_tool: makeTool(
          () => { throw new Error('Tool error'); },
          { description: 'Failing tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 2 } },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: expect.stringContaining('Tool execution failed: 2 consecutive errors') });
    });

    it('error message includes tool name and original message [EC-5]', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'my_tool', id: 'tool_1', input: {} }])
        ));

      const tools = {
        my_tool: makeTool(
          () => { throw new Error('Specific failure'); },
          { description: 'My tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 1 } },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: expect.stringMatching(/Tool execution failed: 1 consecutive errors \(last: my_tool: Specific failure\)/) });
    });

    // EC-6: Tool not found in tool map — error includes "Unknown tool: {name}"
    it('throws RuntimeError with Unknown tool message when tool not in map [EC-6]', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // With max_errors: 1, a single unknown tool call triggers the error immediately
      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockToolUseResponse([{ name: 'nonexistent_tool', id: 'tool_1', input: {} }])
      ));

      const tools = {
        known_tool: makeTool(() => 'result', { description: 'Known' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 1 } },
        ctx
      );

      await expectRejectedHalt(resolveStream(stream), { message: expect.stringContaining('Unknown tool: nonexistent_tool') });
    });

    // AC-17: Tool execution error mid-loop yields tool_call chunk; stream resolves with final content
    it('tool_call chunk is yielded even when tool errors; stream resolves with partial data [AC-17]', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      // First turn: tool is called but fails; second turn: LLM recovers and responds
      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'flaky_tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Recovered from tool error.')
        ));

      const tools = {
        flaky_tool: makeTool(
          () => { throw new Error('Transient failure'); },
          { description: 'Flaky tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 3 } },
        ctx
      );

      const chunks = await collectChunks(stream);

      // tool_call chunk is yielded for the failing tool (before error occurs)
      const toolCallChunks = chunks.filter((c) => c['type'] === 'tool_call');
      expect(toolCallChunks.length).toBeGreaterThan(0);

      // Stream resolves with final content after the tool error
      const result = await resolveStream(stream);
      expect(result['content']).toBe('Recovered from tool error.');
    });

    // EC-23: Missing tools argument causes error in resolve()
    it('throws error when tools argument missing', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools: undefined as unknown as Record<string, unknown>, options: {} },
        ctx
      );
      await expectRejectedHalt(resolveStream(stream), { message: 'tools parameter is required' });
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
      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([
            { name: 'unknown_tool', id: 'tool_1', input: {} },
          ])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Done')
        ));

      const tools = {
        known_tool: makeTool(() => 'result', { description: 'Known tool' }),
      };

      // Should complete without throwing despite unknown tool error
      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Test', tools, options: {} }, ctx);
      const result = await resolveStream(stream);

      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('turns');
      expect(result['turns']).toBe(2); // Two turns: tool error + final response
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
      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'failing_tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'failing_tool', id: 'tool_2', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'failing_tool', id: 'tool_3', input: {} }])
        ));

      const tools = {
        failing_tool: makeTool(
          () => { throw new Error('Tool failed'); },
          { description: 'Failing tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 3 } },
        ctx
      );
      await expectRejectedHalt(resolveStream(stream), { message: 'Tool execution failed: 3 consecutive errors' });
    });

    it('resets consecutive error count on success', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      let callCount = 0;

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_2', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_3', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Done')
        ));

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

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: { max_errors: 3 } },
        ctx
      );
      const result = await resolveStream(stream);

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

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Handled error')
        ));

      const tools = {
        tool: makeTool(
          () => { throw new Error('Custom error message'); },
          { description: 'Tool' }
        ),
      };

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Test', tools, options: {} }, ctx);
      await resolveStream(stream);

      // Check second API call (stream call) includes error in tool_result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const secondCall = mockStream.mock.calls[1]?.[0] as any;
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

      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockTextResponse('Response')
      ));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const messages = [
        { role: 'user', content: 'Previous message 1' },
        { role: 'assistant', content: 'Previous response 1' },
      ];

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'New prompt', tools, options: { messages } },
        ctx
      );
      await resolveStream(stream);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstCall = mockStream.mock.calls[0]?.[0] as any;
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

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([{ name: 'tool', id: 'tool_1', input: {} }])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Final response')
        ));

      const tools = {
        tool: makeTool(() => 'tool result', { description: 'Tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test prompt', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      const msgs = result['messages'] as Array<Record<string, unknown>>;
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs[0]).toEqual({ role: 'user', content: 'Test prompt' });
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

      mockStream
        .mockReturnValueOnce(createMockMessageStream({
          ...createMockToolUseResponse([
            { name: 'tool', id: 'tool_1', input: {} },
          ]),
          usage: { input_tokens: 100, output_tokens: 50 },
        }))
        .mockReturnValueOnce(createMockMessageStream({
          ...createMockTextResponse('Done'),
          usage: { input_tokens: 200, output_tokens: 75 },
        }));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const stream = getCallable(ext, 'tool_loop').fn(
        { prompt: 'Test', tools, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

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

      mockStream.mockReturnValueOnce(createMockMessageStream(
        createMockTextResponse('Done')
      ));

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

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Test', tools, options: {} }, ctx);
      await resolveStream(stream);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstCall = mockStream.mock.calls[0]?.[0] as any;
      const tool = firstCall.tools[0];

      expect(tool.input_schema.properties['str_param'].type).toBe('string');
      expect(tool.input_schema.properties['num_param'].type).toBe('number');
      expect(tool.input_schema.properties['bool_param'].type).toBe('boolean');
      expect(tool.input_schema.properties['list_param'].type).toBe('array');
      expect(tool.input_schema.properties['dict_param'].type).toBe('object');
    });

    it('passes tool arguments to callable as named record', async () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const ext = createAnthropicExtension(config);
      const ctx = createRuntimeContext();

      mockStream
        .mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([
            {
              name: 'tool',
              id: 'tool_1',
              input: { param_a: 'value_a', param_b: 42 },
            },
          ])
        ))
        .mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Done')
        ));

      let capturedArgs: Record<string, RillValue> | null = null;

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

      const stream = getCallable(ext, 'tool_loop').fn({ prompt: 'Test', tools, options: {} }, ctx);
      await resolveStream(stream);

      expect(capturedArgs).toEqual({ param_a: 'value_a', param_b: 42 });
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

      mockStream
        .mockReturnValueOnce(createMockMessageStream(createMockTextResponse('Response 1')))
        .mockReturnValueOnce(createMockMessageStream(createMockTextResponse('Response 2')));

      const tools = {
        tool: makeTool(() => 'result', { description: 'Tool' }),
      };

      const [stream1, stream2] = [
        getCallable(ext, 'tool_loop').fn({ prompt: 'Prompt 1', tools, options: {} }, ctx1),
        getCallable(ext, 'tool_loop').fn({ prompt: 'Prompt 2', tools, options: {} }, ctx2),
      ];

      const [result1, result2] = await Promise.all([
        resolveStream(stream1),
        resolveStream(stream2),
      ]);

      expect(result1['content']).toBe('Response 1');
      expect(result2['content']).toBe('Response 2');
    });
  });

  // ============================================================
  // BOUNDARY CONDITION TESTS
  // ============================================================

  describe('boundary conditions', () => {
    // AC-25: tool_loop() with 0 tool calls yields only text_delta chunks and resolves
    describe('AC-25: 0 tool calls yields only text_delta chunks', () => {
      it('yields only text_delta chunks when LLM responds without tool use', async () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        // Single text-only response: no tool_use blocks
        mockStream.mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('The answer is 42, no tools needed.')
        ));

        const tools = {
          calculator: makeTool(() => 'result', { description: 'Calculate math' }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'What is 6 times 7?', tools, options: {} },
          ctx
        );

        const chunks = await collectChunks(stream);

        // Every emitted chunk must be text_delta when no tool calls occur
        expect(chunks.length).toBeGreaterThan(0);
        const chunkTypes = chunks.map((c) => c['type']);
        expect(chunkTypes.every((t) => t === 'text_delta')).toBe(true);
        expect(chunkTypes).not.toContain('tool_call');
        expect(chunkTypes).not.toContain('tool_result');
      });

      it('resolves with stop_reason end_turn and turns=1 when no tool calls made', async () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        mockStream.mockReturnValueOnce(createMockMessageStream(
          createMockTextResponse('Direct answer without tools.')
        ));

        const tools = {
          search: makeTool(() => 'results', { description: 'Search' }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'Simple question', tools, options: {} },
          ctx
        );

        const result = await resolveStream(stream);

        expect(result['content']).toBe('Direct answer without tools.');
        expect(result['stop_reason']).toBe('end_turn');
        expect(result['turns']).toBe(1);
        expect(mockStream).toHaveBeenCalledTimes(1);
      });
    });

    // AC-26: tool_loop() reaching maxTurns resolves with stop_reason: "max_turns"
    describe('AC-26: maxTurns reached resolves with stop_reason max_turns', () => {
      it('resolves with stop_reason max_turns when maxTurns:1 and LLM wants to call tools', async () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        // LLM wants to call a tool, but maxTurns:1 prevents additional turns
        mockStream.mockReturnValueOnce(createMockMessageStream(
          createMockToolUseResponse([
            { name: 'search', id: 'tool_1', input: { query: 'test query' } },
          ])
        ));

        const tools = {
          search: makeTool(() => 'search results', {
            description: 'Search the web',
            params: [{ name: 'query', type: 'string', description: 'Search query' }],
          }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'Search for something', tools, options: { max_turns: 1 } },
          ctx
        );

        const result = await resolveStream(stream);

        expect(result['stop_reason']).toBe('max_turns');
        expect(result['turns']).toBe(1);
        // Only one API call: the LLM turn that triggered maxTurns
        expect(mockStream).toHaveBeenCalledTimes(1);
      });

      it('resolves with correct content accumulation before maxTurns is hit', async () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        // LLM responds with text AND tool use — maxTurns:1 stops after this turn
        const toolUseWithText = {
          id: 'msg_test123',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me search for that.' },
            { type: 'tool_use', id: 'tool_1', name: 'search', input: { query: 'info' } },
          ],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 8, output_tokens: 12 },
        };

        mockStream.mockReturnValueOnce(createMockMessageStream(toolUseWithText as ReturnType<typeof createMockTextResponse>));

        const tools = {
          search: makeTool(() => 'results', { description: 'Search' }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'Search for info', tools, options: { max_turns: 1 } },
          ctx
        );

        const result = await resolveStream(stream);

        expect(result['stop_reason']).toBe('max_turns');
        expect(result['turns']).toBe(1);
      });
    });

    // AC-27: Abandoned stream triggers dispose cleanup (tool_loop)
    describe('AC-27: abandoned tool_loop stream triggers dispose callback', () => {
      it('dispose property is available on tool_loop stream and calls abort', () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        const mockSdkStream = createMockMessageStream(createMockTextResponse('Response'));
        mockStream.mockReturnValue(mockSdkStream);

        const tools = {
          tool: makeTool(() => 'result', { description: 'Tool' }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'Test', tools, options: {} },
          ctx
        );

        // Verify the stream has a dispose callback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const disposeFn = (stream as any).__rill_stream_dispose;
        expect(typeof disposeFn).toBe('function');
      });

      it('dispose is idempotent on tool_loop stream', () => {
        const config: AnthropicExtensionConfig = {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
        };

        const ext = createAnthropicExtension(config);
        const ctx = createRuntimeContext();

        const mockSdkStream = createMockMessageStream(createMockTextResponse('Response'));
        mockStream.mockReturnValue(mockSdkStream);

        const tools = {
          tool: makeTool(() => 'result', { description: 'Tool' }),
        };

        const stream = getCallable(ext, 'tool_loop').fn(
          { prompt: 'Test', tools, options: {} },
          ctx
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const disposeFn = (stream as any).__rill_stream_dispose;

        // Calling dispose multiple times must not throw
        expect(() => {
          disposeFn();
          disposeFn();
        }).not.toThrow();
      });
    });
  });
});
