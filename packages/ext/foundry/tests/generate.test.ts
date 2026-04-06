/**
 * Tests for generate() host function.
 * Covers AC-6 from the specification.
 *
 * AC-6: generate called with prompt + schema returns dict matching schema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';
import { createFoundryExtension } from '../src/factory.js';
import type { FoundryConfig } from '../src/types.js';

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

/** Build a RillTypeValue from a TypeStructure for use in generate() schema arg. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return { __rill_type: true, typeName: structure.kind, structure } as unknown as RillTypeValue;
}

function createGenerateMockResponse(jsonContent: string, model = 'gpt-4o') {
  return {
    id: 'chatcmpl-gen123',
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

const PERSON_SCHEMA = typeVal({
  kind: 'dict',
  fields: {
    name: { type: { kind: 'string' } },
    age: { type: { kind: 'number' } },
  },
});

const SCORE_SCHEMA = typeVal({
  kind: 'dict',
  fields: {
    score: { type: { kind: 'number' } },
  },
});

const NAME_SCHEMA = typeVal({
  kind: 'dict',
  fields: {
    name: { type: { kind: 'string' } },
  },
});

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    // AC-6: data field contains schema-matching keys
    it('returns data dict with keys matching the schema', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('{"name":"Alice","age":30}')
      );

      const ext = await createFoundryExtension(baseConfig);
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
    });

    // AC-6: data is the parsed object, not the raw JSON string
    it('returns data as parsed object, not raw string', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"score":99}'));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'rate something', schema: SCORE_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(typeof result['data']).toBe('object');
      expect(result['data']).not.toBe('{"score":99}');
      expect((result['data'] as Record<string, unknown>)['score']).toBe(99);
    });

    // AC-6: result contains model field
    it('result dict contains model field', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"name":"Bob"}'));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'give a name', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['model']).toBe('gpt-4o');
    });

    // AC-6: result contains usage field with input and output tokens
    it('result dict contains usage with input and output tokens', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"name":"Carol"}'));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'give a name', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      const usage = result['usage'] as Record<string, unknown>;
      expect(usage).toBeDefined();
      expect(usage['input']).toBe(50);
      expect(usage['output']).toBe(20);
    });

    // AC-6: result contains raw JSON string
    it('result dict contains raw JSON string', async () => {
      const jsonContent = '{"name":"Dave"}';
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'give a name', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['raw']).toBe(jsonContent);
    });

    // AC-6: sends json_schema response_format to the API
    it('sends json_schema response_format to the API', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"score":42}'));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await getCallable(ext, 'generate').fn(
        { prompt: 'rate it', schema: SCORE_SCHEMA, options: {} },
        ctx
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({
            type: 'json_schema',
          }),
        })
      );
    });

    // AC-6: stop_reason field is present in result
    it('result dict contains stop_reason field', async () => {
      mockCreate.mockResolvedValue(createGenerateMockResponse('{"name":"Eve"}'));

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'generate').fn(
        { prompt: 'give a name', schema: NAME_SCHEMA, options: {} },
        ctx
      )) as Record<string, unknown>;

      expect(result['stop_reason']).toBe('stop');
    });
  });

  describe('error cases', () => {
    // AC-6: throws when no schema provided
    it('throws RuntimeError when schema is missing', async () => {
      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'test', schema: undefined, options: {} },
          ctx
        )
      ).rejects.toThrow('generate requires a type expression as schema');
    });

    // AC-6: throws when schema is not a dict type
    it('throws RuntimeError when schema is not a dict type', async () => {
      const stringSchema = typeVal({ kind: 'string' });

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'test', schema: stringSchema, options: {} },
          ctx
        )
      ).rejects.toThrow('generate requires a dict type as schema');
    });

    // AC-6: throws when response JSON is malformed
    it('throws RuntimeError when response JSON cannot be parsed', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('not valid json {{{')
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'generate').fn(
          { prompt: 'test', schema: PERSON_SCHEMA, options: {} },
          ctx
        )
      ).rejects.toMatchObject({ errorId: 'RILL-R004' });
    });
  });
});
