/**
 * Function behavior tests for generate()
 * Validates runtime behavior, error handling, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt } from './_halt-helpers.js';
import { createRuntimeContext } from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/types.js';
import { getCallable, typeVal } from './_functions-helpers.js';

// Mock the OpenAI SDK at module level
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
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const baseConfig: OpenAIExtensionConfig = {
    api_key: 'test-key',
    model: 'gpt-4o',
  };

  function createGenerateMockResponse(jsonContent: string, model = 'gpt-4o') {
    return {
      id: 'chatcmpl-gen-test',
      object: 'chat.completion' as const,
      created: 1234567890,
      model,
      choices: [
        {
          index: 0,
          logprobs: null,
          message: { role: 'assistant' as const, content: jsonContent },
          finish_reason: 'stop' as const,
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
    };
  }

  describe('success cases', () => {
    // AC-6: returns dict with exactly 6 keys: data, raw, model, usage, stop_reason, id
    it('returns dict with data, raw, model, usage, stop_reason, id', async () => {
      const jsonContent = JSON.stringify({ name: 'Alice', age: 30 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'describe a person',
          schema: typeVal({
            kind: 'dict',
            fields: {
              name: { type: { kind: 'string' } },
              age: { type: { kind: 'number' } },
            },
          }),
          options: {},
        },
        ctx
      )) as Record<string, unknown>;

      expect(Object.keys(result).sort()).toEqual(
        [
          'data',
          'id',
          'messages',
          'model',
          'raw',
          'stop_reason',
          'usage',
        ].sort()
      );
    });

    // AC-7: usage is {input: number, output: number}
    it('returns usage with input and output token counts', async () => {
      const jsonContent = JSON.stringify({ name: 'Bob' });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'describe a person',
          schema: typeVal({
            kind: 'dict',
            fields: { name: { type: { kind: 'string' } } },
          }),
          options: {},
        },
        ctx
      )) as Record<string, unknown>;

      expect(result['usage']).toEqual({ input: 15, output: 25 });
    });

    // AC-8: raw contains original JSON string
    it('returns raw as the original JSON string from response', async () => {
      const jsonContent = '{"name":"Charlie","score":99}';
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'score this',
          schema: typeVal({
            kind: 'dict',
            fields: {
              name: { type: { kind: 'string' } },
              score: { type: { kind: 'number' } },
            },
          }),
          options: {},
        },
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonContent);
    });

    // AC-9: system from factory config is sent as system message
    it('uses factory system config as system message', async () => {
      const jsonContent = JSON.stringify({ ok: true });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension({
        ...baseConfig,
        system: 'factory system',
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({
            kind: 'dict',
            fields: { ok: { type: { kind: 'bool' } } },
          }),
        },
        ctx
      );

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMsg = callArgs.messages.find((m) => m.role === 'system');
      expect(systemMsg?.content).toBe('factory system');
    });

    // AC-10: max_tokens factory config caps output tokens
    it('uses factory max_tokens config in API call', async () => {
      const jsonContent = JSON.stringify({ result: 'ok' });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension({ ...baseConfig, max_tokens: 128 });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({
            kind: 'dict',
            fields: { result: { type: { kind: 'string' } } },
          }),
        },
        ctx
      );

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0]![0] as {
        max_completion_tokens: number;
      };
      expect(callArgs.max_completion_tokens).toBe(128);
    });

    // AC-11: multi-turn context via message list in prompt
    it('sends multi-turn message list as conversation context', async () => {
      const jsonContent = JSON.stringify({ answer: 42 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const promptMessages = [
        { role: 'user', content: 'prior question' },
        { role: 'assistant', content: 'prior answer' },
        { role: 'user', content: 'final prompt' },
      ];

      await getCallable(ext, 'generate').fn(
        {
          prompt: promptMessages,
          schema: typeVal({
            kind: 'dict',
            fields: { answer: { type: { kind: 'number' } } },
          }),
        },
        ctx
      );

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const nonSystemMessages = callArgs.messages.filter(
        (m) => m.role !== 'system'
      );
      expect(nonSystemMessages[0]).toEqual({
        role: 'user',
        content: 'prior question',
      });
      expect(nonSystemMessages[1]).toEqual({
        role: 'assistant',
        content: 'prior answer',
      });
      expect(nonSystemMessages[2]).toEqual({
        role: 'user',
        content: 'final prompt',
      });
    });

    // IR-5: response_format uses json_schema with strict: true
    it('sends response_format with type json_schema and strict true', async () => {
      const jsonContent = JSON.stringify({ x: 1 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({
            kind: 'dict',
            fields: { x: { type: { kind: 'number' } } },
          }),
          options: {},
        },
        ctx
      );

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0]![0] as {
        response_format: {
          type: string;
          json_schema: { name: string; strict: boolean; schema: unknown };
        };
      };
      expect(callArgs.response_format.type).toBe('json_schema');
      expect(callArgs.response_format.json_schema.name).toBe('output');
      expect(callArgs.response_format.json_schema.strict).toBe(true);
    });

    // AC-33: success emits openai:generate with model, usage, duration
    it('emits openai:generate event on success', async () => {
      const jsonContent = JSON.stringify({ x: 1 });
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const events: Array<Record<string, unknown>> = [];
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: () => {},
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await getCallable(ext, 'generate').fn(
        {
          prompt: 'prompt',
          schema: typeVal({
            kind: 'dict',
            fields: { x: { type: { kind: 'number' } } },
          }),
          options: {},
        },
        ctx
      );

      const generateEvent = events.find(
        (e) => e['event'] === 'openai:generate'
      );
      expect(generateEvent).toBeDefined();
      expect(generateEvent?.['model']).toBe('gpt-4o');
      expect(generateEvent?.['usage']).toEqual({ input: 15, output: 25 });
      expect(typeof generateEvent?.['duration']).toBe('number');
    });
  });

  describe('error cases', () => {
    // EC-3: no HTTP call when schema is missing
    it('makes no API call when schema is missing', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // EC-4: unsupported type throws RILL-R005 via buildJsonSchema
    it('throws RILL-R005 for unsupported schema type', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          {
            prompt: 'prompt',
            schema: typeVal({
              kind: 'dict',
              fields: { field: { type: { kind: 'unsupported_type' } } },
            }),
            options: {},
          },
          ctx
        ),
        { message: 'unsupported type: unsupported_type' }
      );
    });

    // AC-35: failure emits openai:error with error and duration
    it('emits openai:error event on failure', async () => {
      const events: Array<Record<string, unknown>> = [];
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: () => {},
          onLogEvent: (event) => {
            events.push(event);
          },
        },
      });

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx)
      );

      const errorEvent = events.find((e) => e['event'] === 'openai:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['error']).toBe('string');
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });
});
