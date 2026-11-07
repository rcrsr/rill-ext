/**
 * Boundary condition tests for the OpenAI extension.
 *
 * Covers accepted edge-case inputs (consecutive user turns, image-only turns,
 * empty extra, parallel calls sharing config) and factory-time rejections
 * (max_turns of 0, reserved keys in extra). Prompt and tool_loop argument
 * rejections are asserted for all providers in the shared contract suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  RuntimeError,
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

// ============================================================
// ACCEPTANCE CONDITIONS — VALID INPUTS
// ============================================================

describe('boundary: valid input acceptance', () => {
  beforeEach(() => {
    mockCCStream.mockReset();
  });

  it('accepts two consecutive user turns', async () => {
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
    await resolveStream(stream);

    expect(mockCCStream.mock.calls[0]![0]).toMatchObject({
      messages: [
        { role: 'user', content: 'first user turn' },
        { role: 'user', content: 'second user turn' },
      ],
    });
  });

  it('accepts a user turn with an image-only part', async () => {
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
    await resolveStream(stream);

    const sent = mockCCStream.mock.calls[0]![0] as {
      messages: Array<{ role: string }>;
    };
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0]).toMatchObject({ role: 'user' });
  });

  it('accepts a factory with an empty extra', () => {
    expect(() =>
      createOpenAIExtension({ ...BASE_CONFIG, extra: {} })
    ).not.toThrow();
  });

  it('shares config across 10 parallel message() calls without mutating extra', async () => {
    const extra = { reasoning_effort: 'medium' };
    const ext = createOpenAIExtension({ ...BASE_CONFIG, extra });
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
    expect(extra).toEqual({ reasoning_effort: 'medium' });
  });
});

// ============================================================
// ACCEPTANCE CONDITIONS — FACTORY-TIME ERRORS
// ============================================================

describe('boundary: factory-time validation errors', () => {
  it('throws RILL-R001 with exact message for max_turns of 0', () => {
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

  it.each([
    { key: 'model', extra: { model: 'gpt-99' } },
    { key: 'temperature', extra: { temperature: 0.5 } },
    {
      key: 'previous_response_id',
      extra: { previous_response_id: 'resp-old' },
    },
  ])('throws RILL-R001 naming reserved key $key in extra', ({ key, extra }) => {
    let thrown: unknown;
    try {
      createOpenAIExtension({ ...BASE_CONFIG, extra });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RuntimeError);
    expect((thrown as RuntimeError).errorId).toBe('RILL-R001');
    expect((thrown as RuntimeError).message).toContain(
      `Factory config 'extra' contains reserved key(s): '${key}'.`
    );
  });
});
