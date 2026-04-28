/**
 * Tests for message() and messages() host functions.
 * Covers AC-2 and AC-3 from the specification.
 *
 * AC-2: message called with text returns dict with content, model, usage
 * AC-3: messages called with turn list returns dict with content, model, usage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
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

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
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
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  const resolve = (stream as Record<string, unknown>)['__rill_stream_resolve'] as () => Promise<unknown>;
  return (await resolve()) as Record<string, unknown>;
}

/**
 * Collect string chunks from a RillStream by iterating via next() calls.
 */
async function collectStreamChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current = stream as any;
  while (!current.done) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (current.next as any).fn ?? (current.next as any);
    const fnToCall = typeof fn === 'function' ? fn : (fn as any).fn;
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

    const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);

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

    const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
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

    const stream = getCallable(ext, 'message').fn({ text: 'What is 2+2?' }, ctx);
    const result = await resolveStream(stream);

    const messages = result['messages'] as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const userMsg = messages.find((m) => m['role'] === 'user');
    const assistantMsg = messages.find((m) => m['role'] === 'assistant');
    expect(userMsg).toBeDefined();
    expect(assistantMsg).toBeDefined();
    expect(userMsg?.['content']).toBe('What is 2+2?');
    expect(assistantMsg?.['content']).toBe('Response');
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

    const stream = getCallable(ext, 'message').fn({ text: 'Hello' }, ctx);
    const chunks = await collectStreamChunks(stream);

    expect(chunks).toEqual(['Hello', ' from', ' Foundry!']);
  });

  // AC-2: sends correct parameters to AzureOpenAI streaming API
  it('sends model and messages to the streaming API', async () => {
    const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    getCallable(ext, 'message').fn({ text: 'What is 2+2?' }, ctx);

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
    const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
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

    getCallable(ext, 'message').fn({ text: 'Hi' }, ctx);

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: 'You are helpful.' }),
        ]),
      })
    );
  });

  // AC-2: empty text halts with #INVALID_INPUT
  it('halts with #INVALID_INPUT for empty text', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    expectThrowHalt(() => {
      getCallable(ext, 'message').fn({ text: '' }, ctx);
    }, { code: 'INVALID_INPUT', message: 'prompt text cannot be empty' });
  });
});

// ============================================================
// MESSAGES() TESTS
// ============================================================

describe('messages() function', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  // AC-3: messages() returns RillStream
  it('returns a RillStream object', async () => {
    const runner = createMockStreamRunner(
      ['Sure'],
      createMockFinalCompletion('Sure, I can help!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const inputMessages = [{ role: 'user', content: 'Can you help me?' }];
    const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);

    expect((stream as Record<string, unknown>)['__rill_stream']).toBe(true);
    expect((stream as Record<string, unknown>)['done']).toBe(false);
  });

  // AC-3: resolution dict has content, model, usage
  it('resolves to dict with content, model, usage', async () => {
    const runner = createMockStreamRunner(
      ['Sure, ', 'I can help!'],
      createMockFinalCompletion('Sure, I can help!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const inputMessages = [{ role: 'user', content: 'Can you help me?' }];
    const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);
    const result = await resolveStream(stream);

    expect(result['content']).toBe('Sure, I can help!');
    expect(result['model']).toBe('gpt-4o');
    expect(result['usage']).toEqual({ input: 10, output: 20 });
    expect(result['stop_reason']).toBe('stop');
    expect(result['id']).toBe('chatcmpl-test123');
  });

  // AC-3: multi-turn conversation messages are passed correctly
  it('passes multi-turn conversation to the API', async () => {
    const runner = createMockStreamRunner([], createMockFinalCompletion('Response'));
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const inputMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ];
    getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello' }),
          expect.objectContaining({ role: 'assistant', content: 'Hi there!' }),
          expect.objectContaining({ role: 'user', content: 'How are you?' }),
        ]),
      })
    );
  });

  // AC-3: messages field in result contains conversation
  it('resolves with messages array in result', async () => {
    const runner = createMockStreamRunner(
      ['Response'],
      createMockFinalCompletion('Response')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const inputMessages = [{ role: 'user', content: 'Tell me something' }];
    const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);
    const result = await resolveStream(stream);

    expect(Array.isArray(result['messages'])).toBe(true);
  });

  // AC-3: iterating stream yields string chunks
  it('iterating stream yields string text deltas', async () => {
    const runner = createMockStreamRunner(
      ['Sure', ', I', ' can', ' help!'],
      createMockFinalCompletion('Sure, I can help!')
    );
    mockStream.mockReturnValue(runner);

    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    const inputMessages = [{ role: 'user', content: 'Can you help me?' }];
    const stream = getCallable(ext, 'messages').fn({ messages: inputMessages }, ctx);
    const chunks = await collectStreamChunks(stream);

    expect(chunks).toEqual(['Sure', ', I', ' can', ' help!']);
  });

  // AC-3: empty messages list halts with #INVALID_INPUT
  it('halts with #INVALID_INPUT for empty messages list', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    expectThrowHalt(() => {
      getCallable(ext, 'messages').fn({ messages: [] }, ctx);
    }, { code: 'INVALID_INPUT', message: 'messages list cannot be empty' });
  });

  // AC-3: message missing role halts with #INVALID_INPUT
  it('halts with #INVALID_INPUT when message is missing role field', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    expectThrowHalt(() => {
      getCallable(ext, 'messages').fn(
        { messages: [{ content: 'no role here' }] },
        ctx
      );
    }, { code: 'INVALID_INPUT', message: "required 'role' field" });
  });

  // AC-3: invalid role halts with #INVALID_INPUT
  it('halts with #INVALID_INPUT for invalid role', async () => {
    const ext = await createFoundryExtension(baseConfig);
    const ctx = createRuntimeContext();

    expectThrowHalt(() => {
      getCallable(ext, 'messages').fn(
        { messages: [{ role: 'system', content: 'system message' }] },
        ctx
      );
    }, { code: 'INVALID_INPUT', message: 'invalid role' });
  });
});
