/**
 * Wire-format tests for the OpenAI extension (NFR-UNIFY-2).
 *
 * Asserts that canonical message shapes map to the correct vendor SDK wire
 * format for both Chat Completions and Responses API paths.
 *
 * Coverage:
 *   AC-3   — tool_calls flattening on Chat Completions
 *   AC-7   — extra forwarded verbatim into request params
 *   AC-11  — ReasoningItem (thinking) roundtrip through Responses API
 *   AC-B10 — routing fixed at factory init (o-series → Responses API, standard → Chat Completions)
 *   IC-29  — function_call_output in Responses API
 *   IC-32  — call_id preserved through tool_use/tool_result roundtrip
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';

// ============================================================
// MOCK SETUP
// ============================================================

const mockCCCreate = vi.fn();
const mockCCStream = vi.fn();
const mockResponsesCreate = vi.fn();
const mockResponsesStream = vi.fn();
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

  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCCCreate,
          stream: mockCCStream,
        },
      };
      responses = {
        create: mockResponsesCreate,
        stream: mockResponsesStream,
      };
      embeddings = {
        create: mockEmbeddingsCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Resolves a RillStream returned from a host function.
 */
async function resolveStream(
  stream: unknown
): Promise<Record<string, unknown>> {
  const resolve = (stream as Record<string, unknown>)[
    '__rill_stream_resolve'
  ] as () => Promise<unknown>;
  return (await resolve()) as Record<string, unknown>;
}

/**
 * Build a minimal Chat Completion response.
 */
function mockCCResponse(
  content: string,
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        finish_reason: (toolCalls && toolCalls.length > 0
          ? 'tool_calls'
          : 'stop') as string,
        message: {
          role: 'assistant' as const,
          content: content || null,
          ...(toolCalls && toolCalls.length > 0
            ? {
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/**
 * Build a minimal CC stream runner that resolves with finalChatCompletion.
 */
function mockCCStreamRunner(
  finalCompletion: ReturnType<typeof mockCCResponse>
) {
  async function* asyncChunks() {
    // no streaming deltas for wire-format tests
  }
  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/**
 * Build a minimal Responses API response.
 */
function mockResponsesResponse(
  outputItems: Array<{
    type: string;
    [key: string]: unknown;
  }>
) {
  return {
    id: 'resp-test',
    model: 'o1',
    status: 'completed',
    output: outputItems,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/**
 * Build a mock Responses API stream runner. message() now issues a single
 * request via client.responses.stream() and reads the result from
 * runner.finalResponse(), so the runner exposes both.
 */
function mockResponsesStreamObj(
  finalResponse?: ReturnType<typeof mockResponsesResponse>
) {
  async function* asyncEvents() {
    // no events for resolve-only tests
  }
  return {
    [Symbol.asyncIterator]: asyncEvents,
    finalResponse: vi.fn().mockResolvedValue(finalResponse),
    abort: vi.fn(),
  };
}

// ============================================================
// CHAT COMPLETIONS WIRE-FORMAT
// ============================================================

describe('Chat Completions wire-format', () => {
  beforeEach(() => {
    mockCCCreate.mockReset();
    mockCCStream.mockReset();
  });

  // AC-3: assistant Message with tool_use parts → tool_calls in CC request
  it('AC-3: tool_use parts in assistant turn map to tool_calls in CC wire format', async () => {
    // message() with a multi-turn list that already has an assistant turn with tool_use.
    // We drive the wire format by passing a list with an assistant turn that has a tool_use part,
    // followed by a user turn with a tool_result (to satisfy no-trailing-assistant rule).
    const finalCompletion = mockCCResponse('done');
    const runner = mockCCStreamRunner(finalCompletion);
    mockCCStream.mockReturnValue(runner);

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'user', content: 'call the tool' },
      {
        role: 'assistant',
        parts: [{ type: 'tool_use', id: 'tu_1', name: 'fn', input: { x: 1 } }],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            id: 'tu_1',
            parts: [{ type: 'text', text: 'ok' }],
          },
        ],
      },
    ] as RillValue;

    const stream = getCallable(ext, 'message').fn({ prompt }, ctx);
    await resolveStream(stream);

    expect(mockCCStream).toHaveBeenCalledOnce();
    const callArgs = mockCCStream.mock.calls[0]![0] as {
      messages: Array<Record<string, unknown>>;
    };

    // assistant message with tool_calls
    const assistantMsg = callArgs.messages.find(
      (m) => m['role'] === 'assistant'
    );
    expect(assistantMsg).toBeDefined();
    const toolCalls = assistantMsg!['tool_calls'] as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    expect(Array.isArray(toolCalls)).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe('tu_1');
    expect(toolCalls[0]!.type).toBe('function');
    expect(toolCalls[0]!.function.name).toBe('fn');
    expect(JSON.parse(toolCalls[0]!.function.arguments)).toEqual({ x: 1 });
  });

  // tool_result → role:'tool' with tool_call_id
  it('tool_result part in user turn maps to role:tool message with tool_call_id', async () => {
    const finalCompletion = mockCCResponse('done');
    const runner = mockCCStreamRunner(finalCompletion);
    mockCCStream.mockReturnValue(runner);

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'user', content: 'call the tool' },
      {
        role: 'assistant',
        parts: [{ type: 'tool_use', id: 'tu_1', name: 'fn', input: {} }],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            id: 'tu_1',
            parts: [{ type: 'text', text: 'ok' }],
          },
        ],
      },
    ] as RillValue;

    const stream = getCallable(ext, 'message').fn({ prompt }, ctx);
    await resolveStream(stream);

    expect(mockCCStream).toHaveBeenCalledOnce();
    const callArgs = mockCCStream.mock.calls[0]![0] as {
      messages: Array<Record<string, unknown>>;
    };

    const toolMsg = callArgs.messages.find((m) => m['role'] === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!['tool_call_id']).toBe('tu_1');
    expect(toolMsg!['content']).toBe('ok');
  });

  // AC-7: extra config forwarded verbatim to CC stream call
  it('AC-7: extra fields forwarded verbatim into Chat Completions stream request', async () => {
    const finalCompletion = mockCCResponse('done');
    const runner = mockCCStreamRunner(finalCompletion);
    mockCCStream.mockReturnValue(runner);

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
      extra: { reasoning_effort: 'high' },
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn({ prompt: 'hello' }, ctx);
    await resolveStream(stream);

    expect(mockCCStream).toHaveBeenCalledOnce();
    const callParams = mockCCStream.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callParams['reasoning_effort']).toBe('high');
  });

  // AC-B10: standard model → Chat Completions; multiple calls use same path
  it('AC-B10: standard model always uses Chat Completions (routing fixed at factory init)', async () => {
    const finalCompletion = mockCCResponse('response');
    const runner1 = mockCCStreamRunner(finalCompletion);
    const runner2 = mockCCStreamRunner(finalCompletion);
    mockCCStream.mockReturnValueOnce(runner1).mockReturnValueOnce(runner2);

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'gpt-4o-mini',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    // Two separate calls on the same factory instance
    const s1 = getCallable(ext, 'message').fn({ prompt: 'first' }, ctx);
    await resolveStream(s1);
    const s2 = getCallable(ext, 'message').fn({ prompt: 'second' }, ctx);
    await resolveStream(s2);

    expect(mockCCStream).toHaveBeenCalledTimes(2);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });
});

// ============================================================
// RESPONSES API WIRE-FORMAT
// ============================================================

describe('Responses API wire-format', () => {
  beforeEach(() => {
    mockCCCreate.mockReset();
    mockCCStream.mockReset();
    mockResponsesCreate.mockReset();
    mockResponsesStream.mockReset();
  });

  // AC-11: ReasoningItem → canonical {type:'thinking', text:'...'} part
  it('AC-11: ReasoningItem in Responses API response maps to thinking part with summary text', async () => {
    const responseObj = mockResponsesResponse([
      {
        type: 'reasoning',
        id: 'reasoning_001',
        summary: [{ type: 'summary_text', text: 'step by step thinking' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'final answer' }],
      },
    ]);
    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(responseObj));

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'o1',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn(
      { prompt: 'think please' },
      ctx
    );
    const result = await resolveStream(stream);

    const messages = result['messages'] as Array<{
      role: string;
      parts: Array<{ type: string; text?: string }>;
    }>;
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    const thinkingPart = assistantMsg!.parts.find((p) => p.type === 'thinking');
    expect(thinkingPart).toBeDefined();
    expect(thinkingPart!.text).toBe('step by step thinking');
  });

  // IC-32: call_id (not id) preserved through tool_use roundtrip in Responses API
  it('IC-32: function_call uses call_id (not id) in Responses API output', async () => {
    // Simulate a Responses API response with a function_call item
    const responseObj = mockResponsesResponse([
      {
        type: 'function_call',
        call_id: 'call_abc123',
        name: 'my_tool',
        arguments: '{"q":"test"}',
      },
    ]);
    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(responseObj));

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'o3',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn(
      { prompt: 'use the tool' },
      ctx
    );
    const result = await resolveStream(stream);

    const messages = result['messages'] as Array<{
      role: string;
      parts: Array<{ type: string; id?: string; name?: string }>;
    }>;
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();

    const toolUsePart = assistantMsg!.parts.find((p) => p.type === 'tool_use');
    expect(toolUsePart).toBeDefined();
    // call_id from the Responses API becomes the id on the canonical part
    expect(toolUsePart!.id).toBe('call_abc123');
    expect(toolUsePart!.name).toBe('my_tool');
  });

  // IC-29: canonical tool_result → function_call_output with call_id in Responses API input
  it('IC-29: tool_result part maps to function_call_output with call_id in Responses API input', async () => {
    const finalResponse = mockResponsesResponse([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
    ]);
    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(finalResponse));

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'o1',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    // Pass a conversation that includes a tool_result turn
    const prompt: RillValue = [
      { role: 'user', content: 'call tool' },
      {
        role: 'assistant',
        parts: [{ type: 'tool_use', id: 'call_xyz', name: 'fn', input: {} }],
      },
      {
        role: 'user',
        parts: [
          {
            type: 'tool_result',
            id: 'call_xyz',
            parts: [{ type: 'text', text: 'result value' }],
          },
        ],
      },
    ] as RillValue;

    const stream = getCallable(ext, 'message').fn({ prompt }, ctx);
    await resolveStream(stream);

    expect(mockResponsesStream).toHaveBeenCalledOnce();
    const callParams = mockResponsesStream.mock.calls[0]![0] as {
      input: Array<Record<string, unknown>>;
    };

    const fcoItem = callParams.input.find(
      (item) => item['type'] === 'function_call_output'
    );
    expect(fcoItem).toBeDefined();
    expect(fcoItem!['call_id']).toBe('call_xyz');
    expect(fcoItem!['output']).toBe('result value');
  });

  // AC-7: extra config forwarded verbatim to Responses API call
  it('AC-7: extra fields forwarded verbatim into Responses API create request', async () => {
    const responseObj = mockResponsesResponse([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      },
    ]);
    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(responseObj));

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'o1',
      extra: { reasoning_effort: 'high' },
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn({ prompt: 'hello' }, ctx);
    await resolveStream(stream);

    expect(mockResponsesStream).toHaveBeenCalledOnce();
    const callParams = mockResponsesStream.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callParams['reasoning_effort']).toBe('high');
    // model, input are managed fields — they should NOT be overridden by extra
    expect(callParams['model']).toBe('o1');
  });

  // AC-B10: o-series model → Responses API; multiple calls use same path
  it('AC-B10: o-series model always uses Responses API (routing fixed at factory init)', async () => {
    const responseObj = mockResponsesResponse([
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'answer' }],
      },
    ]);
    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(responseObj));

    const config: OpenAIExtensionConfig = {
      api_key: 'sk-test',
      model: 'o1-preview',
    };
    const ext = createOpenAIExtension(config);
    const ctx = createRuntimeContext();

    // Two separate calls on the same factory instance
    const s1 = getCallable(ext, 'message').fn({ prompt: 'first' }, ctx);
    await resolveStream(s1);

    mockResponsesStream.mockReturnValue(mockResponsesStreamObj(responseObj));
    const s2 = getCallable(ext, 'message').fn({ prompt: 'second' }, ctx);
    await resolveStream(s2);

    expect(mockResponsesStream).toHaveBeenCalledTimes(2);
    expect(mockCCStream).not.toHaveBeenCalled();
  });
});
