/**
 * Boundary condition tests for the OpenAI extension.
 *
 * Asserts acceptance criteria for edge-case inputs and error paths.
 *
 * Coverage:
 *   AC-B2  — multiple consecutive user turns accepted
 *   AC-B3  — image-only user turn accepted
 *   AC-B4  — empty tools dict → INVALID_INPUT / empty_tools_dict
 *   AC-B6  — extra:{} accepted
 *   AC-B7  — max_turns:0 → RILL-R001 (verbatim message)
 *   AC-B8  — parallel message() calls do not mutate shared config
 *   AC-E1  — role:'tool' → INVALID_INPUT
 *   AC-E3  — role:'foo' → INVALID_INPUT
 *   AC-E4  — trailing assistant turn → raw.kind=trailing_assistant_turn
 *   AC-E5  — unknown part type:'audio' → INVALID_INPUT
 *   AC-E6  — extra:{model:...} → RILL-R001
 *   AC-E7  — extra:{temperature:...} → RILL-R001
 *   AC-E9  — tool_loop max_turns=-1 → INVALID_INPUT
 *   AC-E13 — message(123) → raw.kind=invalid_prompt_type
 *   AC-E14 — message([]) → raw.kind=empty_message_list
 *   AC-E15 — message("") → raw.kind=empty_prompt
 *   IC-21  — OpenAI reserved key in extra → RILL-R001
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeError,
  RuntimeHaltSignal,
  getStatus,
  callable,
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
 * Build a minimal CC stream runner that resolves successfully.
 */
function mockCCStreamRunner(content = 'response') {
  const finalCompletion = {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        finish_reason: 'stop' as const,
        message: { role: 'assistant' as const, content },
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };

  async function* asyncChunks() {}
  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/** Base config for standard model tests. */
const BASE_CONFIG: OpenAIExtensionConfig = {
  api_key: 'sk-test',
  model: 'gpt-4o-mini',
};

/**
 * Asserts a synchronous throw is a RuntimeHaltSignal with matching code and optional raw.kind.
 */
function expectHaltCode(
  fn: () => unknown,
  code: string,
  rawKind?: string
): RuntimeHaltSignal {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
  const status = getStatus((thrown as RuntimeHaltSignal).value);
  expect(status.code.name).toBe(code);
  if (rawKind !== undefined) {
    expect((status.raw as Record<string, unknown>)['kind']).toBe(rawKind);
  }
  return thrown as RuntimeHaltSignal;
}

// ============================================================
// ACCEPTANCE CONDITIONS — VALID INPUTS
// ============================================================

describe('boundary: valid input acceptance', () => {
  beforeEach(() => {
    mockCCStream.mockReset();
  });

  // AC-B2: multiple consecutive user turns accepted
  it('AC-B2: two consecutive user turns are accepted', async () => {
    const runner = mockCCStreamRunner();
    mockCCStream.mockReturnValue(runner);

    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'user', content: 'first user turn' },
      { role: 'user', content: 'second user turn' },
    ] as RillValue;

    const stream = getCallable(ext, 'message').fn({ prompt }, ctx);
    // Resolving without error confirms acceptance
    await expect(resolveStream(stream)).resolves.toBeDefined();
  });

  // AC-B3: user turn with image-only (no text) accepted
  it('AC-B3: user turn with image-only (no text part) is accepted', async () => {
    const runner = mockCCStreamRunner();
    mockCCStream.mockReturnValue(runner);

    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      {
        role: 'user',
        parts: [
          {
            type: 'image',
            source: {
              kind: 'url',
              data: 'https://example.com/img.png',
              media_type: 'image/png',
            },
          },
        ],
      },
    ] as RillValue;

    const stream = getCallable(ext, 'message').fn({ prompt }, ctx);
    await expect(resolveStream(stream)).resolves.toBeDefined();
  });

  // AC-B6: extra:{} passes validateExtraKeys
  it('AC-B6: factory with extra:{} is accepted', () => {
    expect(() =>
      createOpenAIExtension({ ...BASE_CONFIG, extra: {} })
    ).not.toThrow();
  });

  // AC-B8: parallel calls share factory extra without mutation
  it('AC-B8: 10 parallel message() calls share config without mutation', async () => {
    const ext = createOpenAIExtension({
      ...BASE_CONFIG,
      extra: { reasoning_effort: 'medium' },
    });
    const ctx = createRuntimeContext();

    // Arm 10 runners
    for (let i = 0; i < 10; i++) {
      mockCCStream.mockReturnValueOnce(mockCCStreamRunner(`response-${i}`));
    }

    const streams = Array.from({ length: 10 }, () =>
      getCallable(ext, 'message').fn({ prompt: 'hello' }, ctx)
    );
    await Promise.all(streams.map(resolveStream));

    // All calls reached the CC mock with the same reasoning_effort value
    expect(mockCCStream).toHaveBeenCalledTimes(10);
    for (const call of mockCCStream.mock.calls) {
      const params = call[0] as Record<string, unknown>;
      expect(params['reasoning_effort']).toBe('medium');
    }
  });
});

// ============================================================
// ACCEPTANCE CONDITIONS — FACTORY-TIME ERRORS
// ============================================================

describe('boundary: factory-time validation errors', () => {
  // AC-B7: max_turns:0 → RILL-R001 (verbatim message)
  it('AC-B7: max_turns:0 throws RILL-R001 with exact message', () => {
    expect(() =>
      createOpenAIExtension({ ...BASE_CONFIG, max_turns: 0 })
    ).toThrow(
      "Factory config 'max_turns' must be a positive integer or undefined; sentinel value 0 is reserved for per-call override semantics."
    );

    let thrown: unknown;
    try {
      createOpenAIExtension({ ...BASE_CONFIG, max_turns: 0 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RuntimeError);
  });

  // AC-E6: extra:{model:'...'} → RILL-R001
  it('AC-E6: extra:{model:...} throws RILL-R001', () => {
    expect(() =>
      createOpenAIExtension({
        ...BASE_CONFIG,
        extra: { model: 'gpt-99' } as Record<string, unknown>,
      })
    ).toThrow(RuntimeError);
  });

  // AC-E7: extra:{temperature:0.5} → RILL-R001
  it('AC-E7: extra:{temperature:0.5} throws RILL-R001', () => {
    expect(() =>
      createOpenAIExtension({
        ...BASE_CONFIG,
        extra: { temperature: 0.5 } as Record<string, unknown>,
      })
    ).toThrow(RuntimeError);
  });

  // IC-21: OpenAI Responses API reserved key in extra → RILL-R001
  it('IC-21: extra:{previous_response_id:...} throws RILL-R001 (Responses API reserved key)', () => {
    expect(() =>
      createOpenAIExtension({
        ...BASE_CONFIG,
        extra: { previous_response_id: 'resp-old' } as Record<string, unknown>,
      })
    ).toThrow(RuntimeError);
  });
});

// ============================================================
// ACCEPTANCE CONDITIONS — RUNTIME ERRORS (host function)
// ============================================================

describe('boundary: runtime errors from message()', () => {
  beforeEach(() => {
    mockCCStream.mockReset();
  });

  // AC-E1: role:'tool' → INVALID_INPUT
  it('AC-E1: message with role=tool is rejected with INVALID_INPUT', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'tool', content: 'tool output' },
    ] as RillValue;

    expectHaltCode(
      () => getCallable(ext, 'message').fn({ prompt }, ctx),
      'INVALID_INPUT'
    );
  });

  // AC-E3: role:'foo' → INVALID_INPUT
  it('AC-E3: message with unknown role=foo is rejected with INVALID_INPUT', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'foo', content: 'content' },
    ] as RillValue;

    expectHaltCode(
      () => getCallable(ext, 'message').fn({ prompt }, ctx),
      'INVALID_INPUT'
    );
  });

  // AC-E4: trailing assistant turn → raw.kind=trailing_assistant_turn
  it('AC-E4: trailing assistant turn is rejected with trailing_assistant_turn', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ] as RillValue;

    expectHaltCode(
      () => getCallable(ext, 'message').fn({ prompt }, ctx),
      'INVALID_INPUT',
      'trailing_assistant_turn'
    );
  });

  // AC-E5: unknown part type:'audio' → INVALID_INPUT
  it('AC-E5: unknown part type audio is rejected with INVALID_INPUT', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const prompt: RillValue = [
      {
        role: 'user',
        parts: [{ type: 'audio', data: 'base64audio' }],
      },
    ] as RillValue;

    expectHaltCode(
      () => getCallable(ext, 'message').fn({ prompt }, ctx),
      'INVALID_INPUT'
    );
  });

  // AC-E13: message(123) → raw.kind=invalid_prompt_type
  it('AC-E13: non-string non-list prompt is rejected with invalid_prompt_type', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    expectHaltCode(
      () =>
        getCallable(ext, 'message').fn(
          { prompt: 123 as unknown as RillValue },
          ctx
        ),
      'INVALID_INPUT',
      'invalid_prompt_type'
    );
  });

  // AC-E14: message([]) → raw.kind=empty_message_list
  it('AC-E14: empty message list is rejected with empty_message_list', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    expectHaltCode(
      () =>
        getCallable(ext, 'message').fn(
          { prompt: [] as unknown as RillValue },
          ctx
        ),
      'INVALID_INPUT',
      'empty_message_list'
    );
  });

  // AC-E15: message("") → raw.kind=empty_prompt
  it('AC-E15: empty string prompt is rejected with empty_prompt', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    expectHaltCode(
      () => getCallable(ext, 'message').fn({ prompt: '' as RillValue }, ctx),
      'INVALID_INPUT',
      'empty_prompt'
    );
  });
});

// ============================================================
// ACCEPTANCE CONDITIONS — RUNTIME ERRORS (tool_loop)
// ============================================================

describe('boundary: runtime errors from tool_loop()', () => {
  beforeEach(() => {
    mockCCCreate.mockReset();
    mockCCStream.mockReset();
  });

  // AC-B4: empty tools dict → INVALID_INPUT / empty_tools_dict
  it('AC-B4: empty tools dict is rejected with empty_tools_dict', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    expectHaltCode(
      () =>
        getCallable(ext, 'tool_loop').fn(
          { prompt: 'run a tool', tools: {} as RillValue, max_turns: 0 },
          ctx
        ),
      'INVALID_INPUT',
      'empty_tools_dict'
    );
  });

  // AC-E9: tool_loop max_turns=-1 → INVALID_INPUT
  it('AC-E9: negative per-call max_turns is rejected with INVALID_INPUT', () => {
    const ext = createOpenAIExtension(BASE_CONFIG);
    const ctx = createRuntimeContext();

    const tool = callable(async () => 'result' as RillValue);
    const tools = { my_tool: tool } as unknown as RillValue;

    expectHaltCode(
      () =>
        getCallable(ext, 'tool_loop').fn(
          {
            prompt: 'run a tool',
            tools,
            max_turns: -1 as unknown as RillValue,
          },
          ctx
        ),
      'INVALID_INPUT'
    );
  });
});
