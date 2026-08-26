/**
 * Tests for message() and messages() host functions.
 * Covers AC-2 and AC-3 from the specification.
 *
 * AC-2: message called with text returns dict with content, model, usage
 * AC-3: messages called with turn list returns dict with content, model, usage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createFoundryExtension } from '../src/factory.js';
import type { FoundryConfig } from '../src/types.js';
import { expectThrowHalt } from './_halt-helpers.js';

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

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Build a ChatCompletion mock response matching the AzureOpenAI response shape.
 */
function createMockFinalCompletion(content: string, model = 'gpt-4o') {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/**
 * Build a mock stream runner compatible with client.chat.completions.stream().
 * Implements [Symbol.asyncIterator] for chunk iteration and finalChatCompletion().
 */
function createMockStreamRunner(
  deltas: string[],
  finalCompletion: ReturnType<typeof createMockFinalCompletion>
) {
  async function* asyncChunks() {
    for (const delta of deltas) {
      yield {
        choices: [{ delta: { content: delta }, finish_reason: null, index: 0 }],
        id: 'chatcmpl-test123',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: finalCompletion.model,
      };
    }
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/**
 * Resolve the RillStream by calling its hidden resolve callback.
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
 * Collect string chunks from a RillStream by iterating via next() calls.
 */
type StreamFn = (
  args: Record<string, unknown>,
  ctx: Record<string, unknown>
) => Promise<StreamNode>;
interface StreamNode {
  done?: boolean;
  value?: unknown;
  next: StreamFn | { fn: StreamFn };
}

async function collectStreamChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  let current = stream as StreamNode;
  while (!current.done) {
    const next = current.next;
    const resolved = typeof next === 'function' ? next : (next.fn ?? next);
    const fnToCall = typeof resolved === 'function' ? resolved : resolved.fn;
    current = await fnToCall({}, {});
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }
  return chunks;
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
// MESSAGE() TESTS
// ============================================================

describe('message() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // AC-2: message returns RillStream
  it('returns a RillStream object', async () => {
    const runner = createMockStreamRunner(
      ['Hello'],
      createMockFinalCompletion('Hello from Foundry!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);

    expect((stream as Record<string, unknown>)['__rill_stream']).toBe(true);
    expect((stream as Record<string, unknown>)['done']).toBe(false);
  });

  // AC-2: resolution dict has content, model, usage
  it('resolves to dict with content, model, usage', async () => {
    const runner = createMockStreamRunner(
      ['Hello ', 'from Foundry!'],
      createMockFinalCompletion('Hello from Foundry!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
    const result = await resolveStream(stream);

    expect(result['content']).toBe('Hello from Foundry!');
    expect(result['model']).toBe('gpt-4o');
    expect(result['usage']).toEqual({ input: 10, output: 20 });
    expect(result['stop_reason']).toBe('stop');
    expect(result['id']).toBe('chatcmpl-test123');
  });

  // AC-2: message() includes user and assistant turns in messages field
  it('resolves with messages containing user and assistant turns', async () => {
    const runner = createMockStreamRunner(
      ['Response'],
      createMockFinalCompletion('Response')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn(
      { prompt: 'What is 2+2?' },
      ctx
    );
    const result = await resolveStream(stream);

    const messages = result['messages'] as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const userMsg = messages.find((m) => m['role'] === 'user');
    const assistantMsg = messages.find((m) => m['role'] === 'assistant');
    expect(userMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();
    const userParts = userMsg?.['parts'] as Array<Record<string, unknown>>;
    const assistantParts = assistantMsg?.['parts'] as Array<
      Record<string, unknown>
    >;
    expect(userParts?.[0]?.['text']).toBe('What is 2+2?');
    expect(assistantParts?.[0]?.['text']).toBe('Response');
  });

  // AC-2: iterating the stream yields string chunks
  it('iterating stream yields string text deltas', async () => {
    const runner = createMockStreamRunner(
      ['Hello', ' from', ' Foundry!'],
      createMockFinalCompletion('Hello from Foundry!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const stream = getCallable(ext, 'message').fn({ prompt: 'Hello' }, ctx);
    const chunks = await collectStreamChunks(stream);

    expect(chunks).toEqual(['Hello', ' from', ' Foundry!']);
  });

  // AC-2: sends correct parameters to AzureOpenAI streaming API
  it('sends model and messages to the streaming API', async () => {
    const runner = createMockStreamRunner(
      [],
      createMockFinalCompletion('Response')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    getCallable(ext, 'message').fn({ prompt: 'What is 2+2?' }, ctx);

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'What is 2+2?' }),
        ]),
      })
    );
  });

  // AC-2: system prompt from config is prepended
  it('prepends system message from inference config', async () => {
    const runner = createMockStreamRunner(
      [],
      createMockFinalCompletion('Response')
    );
    mockStream.mockReturnValue(runner);

    const config: FoundryConfig = {
      ...baseConfig,
      inference: {
        ...baseConfig.inference!,
        system: 'You are helpful.',
      },
    };

    const ext = await createFoundryExtension(config);
    const ctx = createRuntimeContext();

    getCallable(ext, 'message').fn({ prompt: 'Hi' }, ctx);

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: 'You are helpful.',
          }),
        ]),
      })
    );
  });

  // AC-2: empty prompt halts with #INVALID_INPUT
  it('halts with #INVALID_INPUT for empty text', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    expectThrowHalt(
      () => {
        getCallable(ext, 'message').fn({ prompt: '' }, ctx);
      },
      { code: 'INVALID_INPUT', message: 'prompt string cannot be empty' }
    );
  });
});
