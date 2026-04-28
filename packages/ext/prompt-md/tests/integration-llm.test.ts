/**
 * AC-6 integration test: list-output closure feeds all three LLM providers.
 *
 * Verifies that a rill list produced by a prompt-md closure with output:list
 * can be passed directly to messages() of Anthropic, OpenAI, and Gemini
 * without any per-provider adaptation branch.
 *
 * Covers: FR-PROMPT-5, NFR-PROMPT-3.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRuntimeContext, isRillStream, type ApplicationCallable } from '@rcrsr/rill';
import { createPromptMdExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_helpers.js';

// ============================================================
// SDK MOCKS
// All three vendor SDKs are stubbed before any imports that
// would load them. The mock factory modules must be declared
// before the extension factory imports below.
// ============================================================

// ── Anthropic mock ───────────────────────────────────────────────────────────

const mockAnthropicStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(status: number, _error: any, message: string, _headers: any) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockAnthropic {
      messages = {
        stream: mockAnthropicStream,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ── OpenAI mock ──────────────────────────────────────────────────────────────

const mockOpenAIStream = vi.fn();

vi.mock('openai', () => {
  class MockAPIError extends Error {
    status: number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(status: number | undefined, _error: any, message: string, _headers: any) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          stream: mockOpenAIStream,
        },
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ── Gemini mock ──────────────────────────────────────────────────────────────

const mockGeminiStream = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContentStream: mockGeminiStream,
      };
    },
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
    },
  };
});

// ============================================================
// LLM EXTENSION IMPORTS (via package names, not source paths)
// Vitest aliases in vitest.config.ts map these package names
// to source files, satisfying §EXT.2.1 (no devDep on ext siblings).
// ============================================================

// eslint-disable-next-line import/order
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';
// eslint-disable-next-line import/order
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';
// eslint-disable-next-line import/order
import { createGeminiExtension } from '@rcrsr/rill-ext-gemini';

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Chat prompt with user + assistant sections.
 * Uses only user and assistant roles, which all three providers accept.
 */
const CHAT_PROMPT_CONTENT = `---
description: Multi-turn chat prompt
params:
  - "query: string"
output: list
---
@@ user
{query}
@@ assistant
I will help you with that.
`;

/** Create an Anthropic-compatible mock stream resolving with the given text. */
function makeAnthropicMockStream(content: string) {
  const response = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: 'claude-sonnet-4-5-20250929',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 10 },
  };
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: content } };
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  };
}

/** Create an OpenAI-compatible mock stream runner. */
function makeOpenAIMockStream(content: string) {
  const finalCompletion = {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: 1234567890,
    model: 'gpt-4-turbo',
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  };

  async function* asyncChunks() {
    yield {
      choices: [{ delta: { content }, finish_reason: null, index: 0 }],
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4-turbo',
    };
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/** Create a Gemini-compatible async iterable (consumed lazily inside the stream). */
function makeGeminiMockStream(content: string): AsyncIterable<{ text: string }> {
  async function* gen() {
    yield { text: content };
  }
  return gen();
}

/** Extract a named ApplicationCallable from an ext factory result value dict. */
function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Temp dir registry for afterEach cleanup. */
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-prompt-md-llm-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((d) =>
      fs.rm(d, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
  mockAnthropicStream.mockReset();
  mockOpenAIStream.mockReset();
  mockGeminiStream.mockReset();
});

// ============================================================
// AC-6: Same closure result feeds all three providers unchanged
// ============================================================

describe('AC-6: list-output closure result feeds all three LLM providers without adaptation', () => {
  it('same rill list passes to anthropic, openai, and gemini messages() with no per-provider branching', async () => {
    // ── Arrange: temp dir with chat.prompt.md ─────────────────────────────────
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'chat.prompt.md'), CHAT_PROMPT_CONTENT, 'utf-8');

    // Set up SDK mocks before creating extensions.
    mockAnthropicStream.mockReturnValue(makeAnthropicMockStream('Anthropic response'));
    mockOpenAIStream.mockReturnValue(makeOpenAIMockStream('OpenAI response'));
    // Gemini stream is set up below (called lazily inside async generator).
    mockGeminiStream.mockResolvedValue(makeGeminiMockStream('Gemini response'));

    const ctx = createRuntimeContext();

    // ── Act: create prompt-md extension and invoke closure ────────────────────
    const promptExt = await createPromptMdExtension({ basePath: dir }, makeFactoryCtx());
    const chatCallable = getCallable(promptExt, 'chat');

    // Invoke the closure to produce the rill list of role dicts.
    const closureResult = await chatCallable.fn({ query: 'What is rill?' }, ctx);

    // Verify the closure result is a rill list of role dicts.
    expect(Array.isArray(closureResult)).toBe(true);
    const messages = closureResult as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: expect.stringContaining('rill') as string });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: expect.any(String) as string });

    // ── Assert: same closureResult feeds all three providers without branching ─
    //
    // The SAME closureResult variable is passed to all three providers below.
    // No per-provider adaptation branch exists in this calling code — the
    // rill list of role dicts is structurally identical for all providers.

    // Provider 1: Anthropic
    const anthropicExt = createAnthropicExtension({
      api_key: 'test-key-anthropic',
      model: 'claude-sonnet-4-5-20250929',
    });
    const anthropicResult = getCallable(anthropicExt, 'messages').fn(
      { messages: closureResult },
      ctx,
    );
    expect(isRillStream(anthropicResult)).toBe(true);

    // Provider 2: OpenAI
    const openaiExt = createOpenAIExtension({
      api_key: 'test-key-openai',
      model: 'gpt-4-turbo',
    });
    const openaiResult = getCallable(openaiExt, 'messages').fn(
      { messages: closureResult },
      ctx,
    );
    expect(isRillStream(openaiResult)).toBe(true);

    // Provider 3: Gemini (messages() is async, so we await it)
    const geminiExt = createGeminiExtension({
      api_key: 'test-key-gemini',
      model: 'gemini-2.0-flash',
    });
    const geminiResult = await getCallable(geminiExt, 'messages').fn(
      { messages: closureResult },
      ctx,
    );
    expect(isRillStream(geminiResult)).toBe(true);

    // Verify Anthropic and OpenAI SDK streams were invoked synchronously
    // (their stream is created eagerly when fn() is called).
    expect(mockAnthropicStream).toHaveBeenCalledOnce();
    expect(mockOpenAIStream).toHaveBeenCalledOnce();

    // Dispose all extensions
    await promptExt.dispose?.();
    await anthropicExt.dispose?.();
    await openaiExt.dispose?.();
    await geminiExt.dispose?.();
  });
});
