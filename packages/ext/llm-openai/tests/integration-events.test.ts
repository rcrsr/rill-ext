/**
 * Integration tests for event emission
 * Validates §4.10 extension event patterns
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';

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
 * Build a full ChatCompletion object matching OpenAI response shape.
 */
function createMockFinalCompletion(content: string, model = 'gpt-4-turbo') {
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
 * Build a mock stream runner with async iteration and finalChatCompletion().
 */
function createMockStreamRunner(
  finalCompletion: ReturnType<typeof createMockFinalCompletion>
) {
  async function* asyncChunks() {
    yield {
      choices: [
        {
          delta: {
            content: finalCompletion.choices[0]?.message?.content ?? '',
          },
          finish_reason: null,
          index: 0,
        },
      ],
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
 * Build a mock stream runner that fails on finalChatCompletion().
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
 * Trigger the resolve callback on a RillStream to emit events.
 */
async function resolveStream(stream: unknown): Promise<unknown> {
  const resolve = (stream as { __rill_stream_resolve: () => Promise<unknown> })
    .__rill_stream_resolve;
  return resolve();
}

// Mock the OpenAI SDK at module level
const mockCreate = vi.fn();
const mockStream = vi.fn();

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
          create: mockCreate,
          stream: mockStream,
        },
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// EVENT EMISSION TESTS
// ============================================================

describe('extension event emission', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  describe('message() events', () => {
    it('emits openai:message event on success', async () => {
      const runner = createMockStreamRunner(
        createMockFinalCompletion('Response')
      );
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      // fn() returns RillStream synchronously; trigger resolve to emit event
      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);
      await resolveStream(stream);

      // Verify event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'openai:message',
        subsystem: 'extension:openai',
        model: 'gpt-4-turbo',
        usage: { input: 10, output: 20 },
      });
      expect(typeof events[0]?.['duration']).toBe('number');
      expect(events[0]?.['duration']).toBeGreaterThanOrEqual(0);
    });

    it('emits openai:error event on API failure', async () => {
      const { APIError } = await import('openai');
      const apiError = new APIError(401, {}, 'Invalid API key', {});
      const runner = createErrorStreamRunner(apiError);
      mockStream.mockReturnValue(runner);

      const config: OpenAIExtensionConfig = {
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      };

      const ext = createOpenAIExtension(config);
      const events: Array<Record<string, unknown>> = [];
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      // fn() returns RillStream; trigger resolve which will fail and emit error event
      const stream = getCallable(ext, 'message').fn({ prompt: 'Test' }, ctx);
      await expect(resolveStream(stream)).rejects.toThrow();

      // Verify error event structure (§4.10)
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'openai:error',
        subsystem: 'extension:openai',
        error: 'OpenAI API error (HTTP 401): Invalid API key',
      });
      expect(typeof events[0]?.['duration']).toBe('number');
    });
  });
});
