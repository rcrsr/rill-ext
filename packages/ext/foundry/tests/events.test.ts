/**
 * Event emission tests for the Foundry extension.
 * Covers AC-13 — emitExtensionEvent called with model, tokens, duration on success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import type { FoundryConfig } from '../src/types.js';

// ============================================================
// MODULE MOCK
// ============================================================

const mockStream = vi.fn();
const mockCreate = vi.fn();

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
    default: class MockAzureOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    AzureOpenAI: class MockAzureOpenAI {
      chat = {
        completions: {
          create: mockCreate,
          stream: mockStream,
        },
      };
      embeddings = { create: vi.fn() };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// HELPERS
// ============================================================

function validConfig(): FoundryConfig {
  return {
    endpoint: 'https://my-foundry.openai.azure.com',
    auth: { type: 'api-key', key: 'test-api-key' },
    inference: {
      model: 'gpt-4o',
      apiVersion: '2025-01-01-preview',
    },
  };
}

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Build a mock stream runner with a successful final chat completion.
 */
function createMockStreamRunner(content: string, model = 'gpt-4o', promptTokens = 10, completionTokens = 20) {
  const finalCompletion = {
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
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };

  async function* asyncChunks() {
    yield {
      choices: [{ delta: { content }, finish_reason: null, index: 0 }],
      id: finalCompletion.id,
      object: 'chat.completion.chunk',
      created: finalCompletion.created,
      model: finalCompletion.model,
    };
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockResolvedValue(finalCompletion),
    abort: vi.fn(),
  };
}

/**
 * Build a mock stream runner that fails on finalChatCompletion.
 */
function createErrorStreamRunner(error: unknown) {
  async function* asyncChunks() {
    // Empty — error happens on finalChatCompletion
  }

  return {
    [Symbol.asyncIterator]: asyncChunks,
    finalChatCompletion: vi.fn().mockRejectedValue(error),
    abort: vi.fn(),
  };
}

/**
 * Resolve a RillStream by calling its internal resolve callback to trigger event emission.
 */
async function resolveStream(stream: unknown): Promise<unknown> {
  return (stream as { __rill_stream_resolve: () => Promise<unknown> }).__rill_stream_resolve();
}

// ============================================================
// EVENT EMISSION TESTS
// ============================================================

describe('extension event emission', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockCreate.mockReset();
  });

  describe('message() events', () => {
    // AC-13: Successful message call emits event with model, tokens, duration
    it('emits foundry:message event on success (AC-13)', async () => {
      mockStream.mockReturnValue(createMockStreamRunner('Hello world', 'gpt-4o', 10, 20));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(validConfig());

      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const stream = getCallable(ext, 'message').fn({ text: 'Hi' }, ctx);
      await resolveStream(stream);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'foundry:message',
        subsystem: 'extension:foundry',
        model: 'gpt-4o',
        inputTokens: 10,
        outputTokens: 20,
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits foundry:message:error event on API failure', async () => {
      const OpenAI = await import('openai');
      const apiError = new OpenAI.APIError(401, {}, 'Unauthorized', {});
      mockStream.mockReturnValue(createErrorStreamRunner(apiError));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(validConfig());

      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const stream = getCallable(ext, 'message').fn({ text: 'Hi' }, ctx);
      await expect(resolveStream(stream)).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'foundry:message:error',
        subsystem: 'extension:foundry',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['error']).toBeDefined();
    });

    it('emitted event duration is a non-negative number', async () => {
      mockStream.mockReturnValue(createMockStreamRunner('Response', 'gpt-4o', 5, 10));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(validConfig());

      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);
      await resolveStream(stream);

      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emitted event model matches the configured model', async () => {
      mockStream.mockReturnValue(createMockStreamRunner('Response', 'gpt-4o', 5, 10));

      const { createFoundryExtension } = await import('../src/factory.js');
      const ext = await createFoundryExtension(validConfig());

      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      const stream = getCallable(ext, 'message').fn({ text: 'Test' }, ctx);
      await resolveStream(stream);

      expect(events[0]?.['model']).toBe('gpt-4o');
    });
  });
});
