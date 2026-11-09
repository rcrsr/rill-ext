/**
 * Factory validation tests
 * Validates config validation and lifecycle management
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import { expectThrowHalt } from './_halt-helpers.js';
import {
  createRuntimeContext,
  getStatus,
  type ApplicationCallable,
  type RuntimeHaltSignal,
} from '@rcrsr/rill';
import { createOpenAIExtension } from '../src/factory.js';
import type { OpenAIExtensionConfig } from '../src/index.js';
import type { LLMExtensionConfig } from '../src/index.js';

const ANY_FUNCTION: unknown = expect.any(Function);
const ANY_STRING: unknown = expect.any(String);

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
          create: vi.fn(),
          stream: mockStream,
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

const VALID_CONFIG: OpenAIExtensionConfig = {
  api_key: 'test-key',
  model: 'gpt-4-turbo',
};

const PROMPT_PARAM = {
  name: 'prompt',
  type: { kind: 'any' },
  defaultValue: undefined,
  annotations: { description: 'String or list of message dicts' },
};

describe('createOpenAIExtension', () => {
  describe('barrel types', () => {
    it('exports LLMExtensionConfig as an object type', () => {
      expectTypeOf<LLMExtensionConfig>().toBeObject();
    });
  });

  describe('configuration validation', () => {
    it.each([
      {
        label: 'api_key is missing',
        config: { model: 'gpt-4-turbo' },
        message: 'api_key is required',
      },
      {
        label: 'api_key is empty',
        config: { api_key: '', model: 'gpt-4-turbo' },
        message: 'api_key cannot be empty',
      },
      {
        label: 'model is missing',
        config: { api_key: 'test-key' },
        message: 'model is required',
      },
      {
        label: 'model is empty',
        config: { api_key: 'test-key', model: '' },
        message: 'model is required',
      },
      {
        label: 'temperature is below 0',
        config: { ...VALID_CONFIG, temperature: -0.1 },
        message: 'temperature must be between 0 and 2',
      },
      {
        label: 'temperature is above 2',
        config: { ...VALID_CONFIG, temperature: 2.1 },
        message: 'temperature must be between 0 and 2',
      },
    ] satisfies Array<{
      label: string;
      config: Partial<OpenAIExtensionConfig>;
      message: string;
    }>)('throws when $label', ({ config, message }) => {
      expect(() =>
        createOpenAIExtension(config as OpenAIExtensionConfig)
      ).toThrow(message);
    });

    it.each([
      {
        label: 'temperature of 0',
        config: { ...VALID_CONFIG, temperature: 0 },
      },
      {
        label: 'temperature of 2',
        config: { ...VALID_CONFIG, temperature: 2 },
      },
      {
        label: 'temperature of 0.7',
        config: { ...VALID_CONFIG, temperature: 0.7 },
      },
      { label: 'omitted temperature', config: VALID_CONFIG },
    ] satisfies Array<{ label: string; config: OpenAIExtensionConfig }>)(
      'accepts $label',
      ({ config }) => {
        expect(() => createOpenAIExtension(config)).not.toThrow();
      }
    );
  });

  describe('extension result structure', () => {
    it.each([
      {
        name: 'message',
        expected: {
          params: [PROMPT_PARAM],
          fn: ANY_FUNCTION,
          annotations: { description: ANY_STRING },
          returnType: { typeName: 'stream' },
        },
      },
      {
        name: 'embed',
        expected: {
          params: [
            {
              name: 'text',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: ANY_FUNCTION,
          annotations: { description: ANY_STRING },
          returnType: { typeName: 'vector' },
        },
      },
      {
        name: 'embed_batch',
        expected: {
          params: [
            {
              name: 'texts',
              type: { kind: 'list' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          fn: ANY_FUNCTION,
          annotations: { description: ANY_STRING },
          returnType: { typeName: 'list' },
        },
      },
      {
        name: 'tool_loop',
        expected: {
          params: [
            PROMPT_PARAM,
            {
              name: 'tools',
              type: { kind: 'dict', valueType: { kind: 'closure' } },
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'max_turns',
              type: { kind: 'number' },
              defaultValue: 0,
              annotations: {},
            },
          ],
          fn: ANY_FUNCTION,
          annotations: { description: ANY_STRING },
          returnType: { typeName: 'stream' },
        },
      },
      {
        name: 'generate',
        expected: {
          params: [
            PROMPT_PARAM,
            {
              name: 'schema',
              type: { kind: 'type' },
              defaultValue: undefined,
              annotations: {
                description: 'Type expression for structured output schema',
              },
            },
          ],
          fn: ANY_FUNCTION,
          annotations: { description: ANY_STRING },
          returnType: { typeName: 'dict' },
        },
      },
    ])('exposes $name callable with its declared structure', (row) => {
      const result = createOpenAIExtension(VALID_CONFIG);
      const value = result.value as Record<string, Record<string, unknown>>;

      expect(value[row.name]).toMatchObject(row.expected);
    });
  });

  describe('dispose lifecycle', () => {
    beforeEach(() => {
      mockStream.mockReset();
    });

    it('resolves when called multiple times (idempotent)', async () => {
      const result = createOpenAIExtension(VALID_CONFIG);

      await expect(result.dispose?.()).resolves.toBeUndefined();
      await expect(result.dispose?.()).resolves.toBeUndefined();
    });

    it('halts later calls with DISPOSED and extension_disposed after dispose', async () => {
      const result = createOpenAIExtension(VALID_CONFIG);
      const message = (result.value as Record<string, ApplicationCallable>)[
        'message'
      ]!;

      await result.dispose?.();

      const thrown = expectThrowHalt(
        () => message.fn({ prompt: 'Hello' }, createRuntimeContext()),
        { code: 'DISPOSED', provider: 'openai' }
      );
      const status = getStatus((thrown as RuntimeHaltSignal).value);
      expect((status.raw as Record<string, unknown>)['kind']).toBe(
        'extension_disposed'
      );
    });

    it('aborts the signal of an in-flight request on dispose', async () => {
      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {},
        finalChatCompletion: vi.fn(),
        abort: vi.fn(),
      });
      const result = createOpenAIExtension(VALID_CONFIG);
      const message = (result.value as Record<string, ApplicationCallable>)[
        'message'
      ]!;

      void message.fn({ prompt: 'Hello' }, createRuntimeContext());
      const options = mockStream.mock.calls[0]![1] as { signal: AbortSignal };
      expect(options.signal.aborted).toBe(false);

      await result.dispose?.();

      expect(options.signal.aborted).toBe(true);
    });
  });
});
