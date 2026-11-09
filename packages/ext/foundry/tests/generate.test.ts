/**
 * Tests for generate() host function.
 * Covers AC-6 from the specification.
 *
 * AC-6: generate called with prompt + schema returns dict matching schema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectRejectedHalt } from './_halt-helpers.js';
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

const mockCreate = vi.fn<(...args: unknown[]) => unknown>();
const mockStream = vi.fn<(...args: unknown[]) => unknown>();
const mockEmbeddingsCreate = vi.fn<(...args: unknown[]) => unknown>();

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

/** Build a RillTypeValue from a TypeStructure for use in generate() schema arg. */
function typeVal(structure: TypeStructure): RillTypeValue {
  return {
    __rill_type: true,
    typeName: structure.kind,
    structure,
  } as unknown as RillTypeValue;
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

// ============================================================
// GENERATE() TESTS
// ============================================================

describe('generate() function', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('success cases', () => {
    it('returns parsed data, model, usage, raw JSON and stop_reason', async () => {
      const jsonContent = '{"name":"Alice","age":30}';
      mockCreate.mockResolvedValue(createGenerateMockResponse(jsonContent));

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

      expect(result['data']).toEqual({ name: 'Alice', age: 30 });
      expect(result['model']).toBe('gpt-4o');
      expect(result['usage']).toMatchObject({ input: 50, output: 20 });
      expect(result['raw']).toBe(jsonContent);
      expect(result['stop_reason']).toBe('stop');
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
          }) as unknown,
        }),
        expect.objectContaining({
          signal: expect.any(AbortSignal) as AbortSignal,
        })
      );
    });
  });

  describe('error cases', () => {
    // AC-6: throws when no schema provided
    it('throws RuntimeError when schema is missing', async () => {
      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn({ prompt: 'test', options: {} }, ctx),
        { message: 'generate requires a type expression as schema' }
      );
    });

    // AC-6: throws when schema is not a dict type
    it('throws RuntimeError when schema is not a dict type', async () => {
      const stringSchema = typeVal({ kind: 'string' });

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'test', schema: stringSchema, options: {} },
          ctx
        ),
        { message: 'generate requires a dict type as schema' }
      );
    });

    // AC-6: halts with #PROTOCOL when response JSON is malformed
    it('halts with #PROTOCOL when response JSON cannot be parsed', async () => {
      mockCreate.mockResolvedValue(
        createGenerateMockResponse('not valid json {{{')
      );

      const ext = await createFoundryExtension(baseConfig);
      const ctx = createRuntimeContext();

      await expectRejectedHalt(
        getCallable(ext, 'generate').fn(
          { prompt: 'test', schema: PERSON_SCHEMA, options: {} },
          ctx
        ),
        { code: 'PROTOCOL', message: 'failed to parse response JSON' }
      );
    });
  });
});
