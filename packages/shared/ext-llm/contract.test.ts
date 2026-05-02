/**
 * Shared contract test harness for all three LLM extension factories.
 *
 * NFR-UNIFY-1: Every LLM extension obeys the SAME boundary contract.
 * This file parameterizes across createAnthropicExtension, createOpenAIExtension,
 * and createGeminiExtension and asserts identical boundary behavior with vendor
 * SDKs mocked.
 *
 * vi.mock paths use relative paths to each extension's own node_modules to ensure
 * vitest intercepts the same module instances that the factories import. Mocking
 * by bare module name (e.g. '@anthropic-ai/sdk') does not work here because the
 * shared package has no dependency on the vendor SDKs — resolution fails silently
 * and the factory imports an un-mocked real module.
 *
 * Covers: AC-1, AC-2, AC-9, AC-12, IC-28
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
  isRillStream,
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
  type ExtensionFactoryResult,
  type RillValue,
  type RillStream,
  RuntimeHaltSignal,
} from '@rcrsr/rill';

// ============================================================
// FACTORY IMPORTS — relative paths because ext packages are not
// listed as npm deps of the shared package. Cross-package
// relative imports are resolved at vitest runtime.
// ============================================================

// @ts-ignore — cross-package relative import; resolved at vitest runtime
import { createAnthropicExtension } from '../../ext/llm-anthropic/src/factory.js';
// @ts-ignore — cross-package relative import; resolved at vitest runtime
import { createOpenAIExtension } from '../../ext/llm-openai/src/factory.js';
// @ts-ignore — cross-package relative import; resolved at vitest runtime
import { createGeminiExtension } from '../../ext/llm-gemini/src/factory.js';

import type { LLMProviderConfig } from './src/types.js';

// ============================================================
// SDK MOCKS
//
// Use relative paths into each extension's node_modules to ensure the mock
// intercepts the same module instance the factory uses. The shared package
// cannot resolve bare vendor SDK names (they are not its dependencies).
// ============================================================

// --- Anthropic mock state ---
const anthropicMockStream = vi.fn();
const anthropicMockCreate = vi.fn();

vi.mock('../../ext/llm-anthropic/node_modules/@anthropic-ai/sdk', () => {
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
        stream: anthropicMockStream,
        create: anthropicMockCreate,
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// --- OpenAI mock state ---
const openaiMockStream = vi.fn();
const openaiMockCreate = vi.fn();

vi.mock('../../ext/llm-openai/node_modules/openai', () => {
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
          stream: openaiMockStream,
          create: openaiMockCreate,
        },
      };
      embeddings = {
        create: vi.fn(),
      };
      responses = {
        stream: vi.fn(),
        create: vi.fn(),
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// --- Gemini mock state ---
const geminiMockGenerateContentStream = vi.fn();
const geminiMockGenerateContent = vi.fn();

vi.mock('../../ext/llm-gemini/node_modules/@google/genai', () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      models = {
        generateContentStream: geminiMockGenerateContentStream,
        generateContent: geminiMockGenerateContent,
        embedContent: vi.fn(),
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
// HELPERS
// ============================================================

/**
 * Extract a named ApplicationCallable from an ExtensionFactoryResult value dict.
 */
function getCallable(ext: ExtensionFactoryResult, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Drain all chunks from a RillStream and then call resolve.
 * Gemini's message() accumulates streamed text during iteration;
 * calling resolve before draining yields an empty result.
 */
async function drainAndResolve(
  stream: RillValue,
  ctx: ReturnType<typeof createRuntimeContext>
): Promise<Record<string, unknown>> {
  let current = stream as RillStream;
  while (!current.done) {
    const nextFn = current.next as ApplicationCallable;
    current = (await nextFn.fn({}, ctx)) as RillStream;
  }
  const resolver = (stream as unknown as { __rill_stream_resolve: () => Promise<unknown> })
    .__rill_stream_resolve;
  return (await resolver()) as Record<string, unknown>;
}

/** Build a RillTypeValue from a TypeStructure. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return { __rill_type: true, typeName: structure.kind, structure } as unknown as RillTypeValue;
}

/** Minimal dict schema for generate() tests. */
const NAME_SCHEMA = typeVal({
  kind: 'dict',
  fields: {
    name: { type: { kind: 'string' } },
  },
});

/**
 * Unwrap a caught error to the underlying invalid RillValue.
 *
 * Anthropic and OpenAI throw RuntimeHaltSignal (err.value = invalid).
 * Gemini returns the invalid value directly from an async fn.
 *
 * Returns the invalid RillValue, or the original value if not a halt signal.
 */
function unwrapError(caughtErr: unknown): unknown {
  if (
    caughtErr instanceof RuntimeHaltSignal &&
    caughtErr.value !== undefined
  ) {
    return caughtErr.value;
  }
  return caughtErr;
}

// ============================================================
// PER-PROVIDER MOCK SETUP
// ============================================================

/**
 * Configure Anthropic mocks for a successful message() call.
 */
function setupAnthropicMessageMock(content: string, model: string): void {
  const response = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };

  anthropicMockStream.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: content } };
    },
    finalMessage: vi.fn().mockResolvedValue(response),
    abort: vi.fn(),
  });
}

/**
 * Configure Anthropic mocks for a successful generate() call.
 */
function setupAnthropicGenerateMock(jsonText: string, model: string): void {
  anthropicMockCreate.mockResolvedValue({
    id: 'msg_gen',
    model,
    stop_reason: 'end_turn',
    usage: { input_tokens: 50, output_tokens: 20 },
    content: [{ type: 'text', text: jsonText }],
  });
}

/**
 * Configure OpenAI mocks for a successful message() call.
 */
function setupOpenAIMessageMock(content: string, model: string): void {
  const finalCompletion = {
    id: 'chatcmpl_test',
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

  openaiMockStream.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield {
        choices: [{ delta: { content }, finish_reason: null, index: 0 }],
        id: 'chatcmpl_test',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model,
      };
    },
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  });
}

/**
 * Configure OpenAI mocks for a successful generate() call.
 */
function setupOpenAIGenerateMock(jsonText: string, model: string): void {
  openaiMockCreate.mockResolvedValue({
    id: 'chatcmpl_gen',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content: jsonText },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  });
}

/**
 * Gemini chunks async generator — yields { text } objects.
 */
async function* geminiChunks(chunks: string[]): AsyncGenerator<{ text: string }> {
  for (const text of chunks) {
    yield { text };
  }
}

/**
 * Configure Gemini mocks for a successful message() call.
 */
function setupGeminiMessageMock(content: string): void {
  geminiMockGenerateContentStream.mockResolvedValue(geminiChunks([content]));
}

/**
 * Configure Gemini mocks for a successful generate() call.
 */
function setupGeminiGenerateMock(jsonText: string): void {
  geminiMockGenerateContent.mockResolvedValue({
    text: jsonText,
    responseId: 'resp_gen',
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
    modelVersion: 'gemini-2.0-flash-001',
  });
}

// ============================================================
// FACTORY DESCRIPTORS
// ============================================================

type FactoryFn = (config: LLMProviderConfig) => ExtensionFactoryResult;

interface FactoryDescriptor {
  name: string;
  factory: FactoryFn;
  model: string;
  setupMessageMock: (content: string) => void;
  setupGenerateMock: (jsonText: string) => void;
  resetMocks: () => void;
}

const FACTORIES: FactoryDescriptor[] = [
  {
    name: 'anthropic',
    factory: createAnthropicExtension as FactoryFn,
    model: 'claude-3-5-sonnet-20241022',
    setupMessageMock: (content: string) => setupAnthropicMessageMock(content, 'claude-3-5-sonnet-20241022'),
    setupGenerateMock: (jsonText: string) => setupAnthropicGenerateMock(jsonText, 'claude-3-5-sonnet-20241022'),
    resetMocks: () => {
      anthropicMockStream.mockReset();
      anthropicMockCreate.mockReset();
    },
  },
  {
    name: 'openai',
    factory: createOpenAIExtension as FactoryFn,
    model: 'gpt-4o',
    setupMessageMock: (content: string) => setupOpenAIMessageMock(content, 'gpt-4o'),
    setupGenerateMock: (jsonText: string) => setupOpenAIGenerateMock(jsonText, 'gpt-4o'),
    resetMocks: () => {
      openaiMockStream.mockReset();
      openaiMockCreate.mockReset();
    },
  },
  {
    name: 'gemini',
    factory: createGeminiExtension as FactoryFn,
    model: 'gemini-2.0-flash',
    setupMessageMock: setupGeminiMessageMock,
    setupGenerateMock: setupGeminiGenerateMock,
    resetMocks: () => {
      geminiMockGenerateContentStream.mockReset();
      geminiMockGenerateContent.mockReset();
    },
  },
];

// ============================================================
// CONTRACT TESTS — parameterized over all 3 factories
// ============================================================

describe.each(FACTORIES)(
  'LLM contract — $name',
  ({ name: _name, factory, model, setupMessageMock, setupGenerateMock, resetMocks }) => {

    beforeEach(() => {
      resetMocks();
    });

    // ──────────────────────────────────────────────────────────
    // AC-1: message("hello") — string prompt succeeds
    // ──────────────────────────────────────────────────────────
    describe('AC-1: message(string) succeeds', () => {
      it('returns a RillStream', async () => {
        setupMessageMock('Hello from AI!');

        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        const result = await messageCallable.fn({ prompt: 'hello' }, ctx);

        expect(isRillStream(result)).toBe(true);
      });

      it('resolves to dict ending with assistant turn containing text part', async () => {
        setupMessageMock('Hello from AI!');

        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        const stream = await messageCallable.fn({ prompt: 'hello' }, ctx);
        const result = await drainAndResolve(stream as RillValue, ctx);

        const messages = result['messages'] as Array<{
          role: string;
          parts: Array<{ type: string; text?: string }>;
        }>;

        expect(Array.isArray(messages)).toBe(true);
        expect(messages.length).toBeGreaterThanOrEqual(2);

        const lastMsg = messages[messages.length - 1]!;
        expect(lastMsg.role).toBe('assistant');

        const textParts = lastMsg.parts.filter((p) => p.type === 'text');
        expect(textParts.length).toBeGreaterThan(0);
        expect(textParts[0]!.text).toBe('Hello from AI!');
      });
    });

    // ──────────────────────────────────────────────────────────
    // AC-2: message([{role:'user', content:'hi'}]) — content-sugar form
    // ──────────────────────────────────────────────────────────
    describe('AC-2: message(list with content-sugar) succeeds', () => {
      it('returns a RillStream for content-sugar form input', async () => {
        setupMessageMock('Hi back!');

        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        const result = await messageCallable.fn(
          { prompt: [{ role: 'user', content: 'hi' }] },
          ctx
        );

        expect(isRillStream(result)).toBe(true);
      });

      it('resolves to dict with assistant turn carrying text part', async () => {
        setupMessageMock('Hi back!');

        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        const stream = await messageCallable.fn(
          { prompt: [{ role: 'user', content: 'hi' }] },
          ctx
        );
        const result = await drainAndResolve(stream as RillValue, ctx);

        const messages = result['messages'] as Array<{
          role: string;
          parts: Array<{ type: string; text?: string }>;
        }>;

        expect(Array.isArray(messages)).toBe(true);
        const lastMsg = messages[messages.length - 1]!;
        expect(lastMsg.role).toBe('assistant');

        const textParts = lastMsg.parts.filter((p) => p.type === 'text');
        expect(textParts[0]!.text).toBe('Hi back!');
      });
    });

    // ──────────────────────────────────────────────────────────
    // AC-9: generate(prompt, schema) returns {data, raw, messages}
    // ──────────────────────────────────────────────────────────
    describe('AC-9: generate(prompt, schema) returns {data, raw, messages}', () => {
      it('returns data, raw, and messages; messages ends with assistant text part containing raw', async () => {
        const jsonText = '{"name":"Alice"}';
        setupGenerateMock(jsonText);

        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const generateCallable = getCallable(ext, 'generate');

        const result = (await generateCallable.fn(
          { prompt: 'describe a person', schema: NAME_SCHEMA },
          ctx
        )) as Record<string, unknown>;

        // data parses against schema
        const data = result['data'] as Record<string, unknown>;
        expect(data).toBeDefined();
        expect(data['name']).toBe('Alice');

        // raw is the original JSON string
        expect(result['raw']).toBe(jsonText);

        // messages ends with assistant turn
        const messages = result['messages'] as Array<{
          role: string;
          parts: Array<{ type: string; text?: string }>;
        }>;
        expect(Array.isArray(messages)).toBe(true);
        const lastMsg = messages[messages.length - 1]!;
        expect(lastMsg.role).toBe('assistant');

        // assistant turn has a single text part containing the raw JSON string
        const textParts = lastMsg.parts.filter((p) => p.type === 'text');
        expect(textParts.length).toBe(1);
        expect(textParts[0]!.text).toBe(jsonText);
      });
    });

    // ──────────────────────────────────────────────────────────
    // AC-12: `messages` callable does NOT exist on the result
    // ──────────────────────────────────────────────────────────
    describe('AC-12: messages callable removed', () => {
      it('does not expose a messages key on the callable dict', () => {
        const ext = factory({ api_key: 'test-key', model });
        const callableDict = ext.value as Record<string, unknown>;

        expect('messages' in callableDict).toBe(false);
        expect(callableDict['messages']).toBeUndefined();
      });

      it('exposes exactly the 5 expected keys: message, embed, embed_batch, tool_loop, generate', () => {
        const ext = factory({ api_key: 'test-key', model });
        const callableDict = ext.value as Record<string, unknown>;

        const keys = Object.keys(callableDict).sort();
        expect(keys).toEqual(['embed', 'embed_batch', 'generate', 'message', 'tool_loop']);
      });
    });

    // ──────────────────────────────────────────────────────────
    // IC-28: Identical boundary errors across all providers
    // ──────────────────────────────────────────────────────────
    describe('IC-28: boundary errors — trailing assistant turn', () => {
      it('fires INVALID_INPUT with raw.kind=trailing_assistant_turn', async () => {
        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        const trailingAssistantPrompt = [
          { role: 'user', content: 'hello' },
          { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        ];

        let errorValue: unknown;
        try {
          const streamOrInvalid = await messageCallable.fn(
            { prompt: trailingAssistantPrompt },
            ctx
          );
          // Gemini returns the invalid value directly
          if (isInvalid(streamOrInvalid)) {
            errorValue = streamOrInvalid;
          } else {
            // Should not reach here — Anthropic/OpenAI throw before returning
            errorValue = streamOrInvalid;
          }
        } catch (err: unknown) {
          // Anthropic and OpenAI throw RuntimeHaltSignal
          errorValue = unwrapError(err);
        }

        expect(isInvalid(errorValue)).toBe(true);
        const status = getStatus(errorValue as RillValue);
        expect((status.code as { name: string }).name).toBe('INVALID_INPUT');
        expect((status.raw as Record<string, unknown>)['kind']).toBe('trailing_assistant_turn');
      });
    });

    describe('IC-28: boundary errors — empty prompt', () => {
      it('fires INVALID_INPUT with raw.kind=empty_prompt', async () => {
        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        let errorValue: unknown;
        try {
          const streamOrInvalid = await messageCallable.fn({ prompt: '' }, ctx);
          if (isInvalid(streamOrInvalid)) {
            errorValue = streamOrInvalid;
          } else {
            errorValue = streamOrInvalid;
          }
        } catch (err: unknown) {
          errorValue = unwrapError(err);
        }

        expect(isInvalid(errorValue)).toBe(true);
        const status = getStatus(errorValue as RillValue);
        expect((status.code as { name: string }).name).toBe('INVALID_INPUT');
        expect((status.raw as Record<string, unknown>)['kind']).toBe('empty_prompt');
      });
    });

    describe("IC-28: boundary errors — invalid role 'foo'", () => {
      it("message([{role:'foo'}]) fires INVALID_INPUT", async () => {
        const ext = factory({ api_key: 'test-key', model });
        const ctx = createRuntimeContext();
        const messageCallable = getCallable(ext, 'message');

        let errorValue: unknown;
        try {
          const streamOrInvalid = await messageCallable.fn(
            { prompt: [{ role: 'foo', content: 'hello' }] },
            ctx
          );
          if (isInvalid(streamOrInvalid)) {
            errorValue = streamOrInvalid;
          } else {
            errorValue = streamOrInvalid;
          }
        } catch (err: unknown) {
          errorValue = unwrapError(err);
        }

        expect(isInvalid(errorValue)).toBe(true);
        const status = getStatus(errorValue as RillValue);
        expect((status.code as { name: string }).name).toBe('INVALID_INPUT');
      });
    });
  }
);
