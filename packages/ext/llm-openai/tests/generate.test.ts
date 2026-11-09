/**
 * generate() function tests
 * Covers generate() data shape, parse-failure handling, provider error
 * mapping, and reasoning_content extraction. Request-wire assertions live in
 * functions.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt } from './_halt-helpers.js';
import {
  createRuntimeContext,
  RuntimeHaltSignal,
  getStatus,
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';
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

/** Build a RillTypeValue from a TypeStructure for test usage. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return {
    __rill_type: true,
    typeName: structure.kind,
    structure,
  } as unknown as RillTypeValue;
}

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
      embeddings = {
        create: vi.fn(),
      };
      static APIError = MockAPIError;
    },
    APIError: MockAPIError,
  };
});

function createGenerateMockResponse(jsonContent: string, model = 'gpt-4o') {
  return {
    id: 'chatcmpl_123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant' as const, content: jsonContent },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  };
}

function createGenerateMockResponseWithReasoning(
  reasoningContent: string,
  content = '',
  model = 'gpt-4o'
) {
  return {
    id: 'chatcmpl_123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content,
          reasoning_content: reasoningContent,
        },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  };
}

const baseConfig: OpenAIExtensionConfig = {
  api_key: 'test-key',
  model: 'gpt-4o',
};

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  const PERSON_SCHEMA = typeVal({
    kind: 'dict',
    fields: {
      name: { type: { kind: 'string' } },
      age: { type: { kind: 'number' } },
    },
  });
  const NAME_SCHEMA = typeVal({
    kind: 'dict',
    fields: { name: { type: { kind: 'string' } } },
  });
  const NUMBER_SCHEMA = typeVal({
    kind: 'dict',
    fields: { x: { type: { kind: 'number' } } },
  });

  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-1: data field contains schema-matching keys
    it('returns data dict with keys matching the schema', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        {
          prompt: 'describe a person',
          schema: PERSON_SCHEMA,
          options: {},
        },
        ctx
      )) as Record<string, unknown>;

      const data = result['data'] as Record<string, unknown>;
      expect(data).toBeDefined();
      expect(data['name']).toBe('Alice');
      expect(data['age']).toBe(30);
      expect(Object.keys(data).sort()).toEqual(['age', 'name']);
    });
  });

  describe('error cases', () => {
    it('maps invalid JSON response to a PROTOCOL halt', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{broken'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: NUMBER_SCHEMA, options: {} },
          ctx
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expect(getStatus((thrown as RuntimeHaltSignal).value).code.name).toBe(
        'PROTOCOL'
      );
    });

    // AC-22/EC-5: "{broken" response throws with original parse error detail
    it('includes original parse error detail in thrown message', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{broken'));

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: NUMBER_SCHEMA, options: {} },
          ctx
        ),
        { message: 'generate: failed to parse response JSON:' }
      );

      // Verify message contains the native JSON parse error detail
      let thrown: unknown;
      try {
        await getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: NUMBER_SCHEMA, options: {} },
          ctx
        );
      } catch (err) {
        thrown = err;
      }

      const message = getStatus((thrown as RuntimeHaltSignal).value).message;
      // Message must contain detail beyond just the prefix
      expect(message.length).toBeGreaterThan(
        'generate: failed to parse response JSON:'.length
      );
    });

    // EC-4: missing schema arg throws RILL-R005
    it('throws RILL-R005 when called without schema argument', async () => {
      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'prompt', options: {} }, ctx),
        {
          message: expect.stringContaining(
            'generate requires a type expression as schema'
          ),
        }
      );
    });

    // AC-27/EC-6: provider API error emits openai:error event
    it('maps provider API error and emits openai:error event', async () => {
      const { APIError } = await import('openai');
      mockCreate.mockRejectedValue(
        new APIError(429, {}, 'Rate limit exceeded', new Headers())
      );

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
        getCallable(ext, 'generate').fn(
          { prompt: 'prompt', schema: NUMBER_SCHEMA, options: {} },
          ctx
        ),
        {
          code: 'RATE_LIMIT',
          message: 'OpenAI API error (HTTP 429): Rate limit exceeded',
        }
      );

      const errorEvent = events.find((e) => e['event'] === 'openai:error');
      expect(errorEvent).toBeDefined();
      expect(typeof errorEvent?.['error']).toBe('string');
      expect(typeof errorEvent?.['duration']).toBe('number');
    });
  });

  describe('reasoning_content fallback (extractJson)', () => {
    // reasoning model: content empty, reasoning_content has pure JSON
    it('parses JSON from reasoning_content when content is empty', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponseWithReasoning('{"name":"Bob"}')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'name someone', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect((result['data'] as Record<string, unknown>)['name']).toBe('Bob');
    });

    // reasoning model: content empty, reasoning_content has thinking prose + JSON
    it('strips prose preamble and parses JSON from reasoning_content', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponseWithReasoning(
          'Let me think about this carefully. The answer is {"name":"Carol"}'
        )
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'name someone', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect((result['data'] as Record<string, unknown>)['name']).toBe('Carol');
    });

    // content has JSON wrapped in markdown fence
    it('extracts JSON from markdown-fenced content', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('```json\n{"name":"Dave"}\n```')
      );

      const ext = createOpenAIExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'name someone', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect((result['data'] as Record<string, unknown>)['name']).toBe('Dave');
    });
  });
});
