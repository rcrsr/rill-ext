/**
 * Factory validation tests
 * Validates config validation and lifecycle management
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  RuntimeError,
  RuntimeHaltSignal,
  type ApplicationCallable,
} from '@rcrsr/rill';
import { expectRejectedHalt } from './_halt-helpers.js';
import { createGeminiExtension } from '../src/factory.js';
import type { GeminiExtensionConfig } from '../src/types.js';
import type { LLMExtensionConfig } from '../src/index.js';

// ============================================================
// VALIDATION TESTS
// ============================================================

describe('createGeminiExtension', () => {
  describe('barrel types', () => {
    it('exports LLMExtensionConfig as an object type', () => {
      expectTypeOf<LLMExtensionConfig>().toBeObject();
    });
  });

  describe('configuration validation', () => {
    it.each([
      {
        field: 'api_key',
        config: { model: 'gemini-2.0-flash' },
        message: 'api_key is required',
      },
      {
        field: 'model',
        config: { api_key: 'test-key' },
        message: 'model is required',
      },
      {
        field: 'temperature',
        config: {
          api_key: 'test-key',
          model: 'gemini-2.0-flash',
          temperature: -0.1,
        },
        message: 'temperature must be between 0 and 2',
      },
    ])('throws RILL-R001 when $field is invalid', ({ config, message }) => {
      let thrown: unknown;
      try {
        createGeminiExtension(config as GeminiExtensionConfig);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R001');
      expect((thrown as RuntimeError).message).toBe(message);
    });
  });

  // AC-1: Factory returns ExtensionFactoryResult with 5 callables
  describe('extension result structure', () => {
    const PROMPT_PARAM = {
      name: 'prompt',
      type: { kind: 'any' },
      defaultValue: undefined,
      annotations: { description: 'String or list of message dicts' },
    };

    it.each([
      {
        name: 'message',
        params: [PROMPT_PARAM],
        returnTypeName: 'stream',
      },
      {
        name: 'embed',
        params: [
          {
            name: 'text',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnTypeName: 'vector',
      },
      {
        name: 'embed_batch',
        params: [
          {
            name: 'texts',
            type: { kind: 'list' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnTypeName: 'list',
      },
      {
        name: 'tool_loop',
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
        returnTypeName: 'stream',
      },
      {
        name: 'generate',
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
        returnTypeName: 'dict',
      },
    ])(
      'exposes $name with its declared params and return type',
      ({ name, params, returnTypeName }) => {
        const result = createGeminiExtension({
          api_key: 'test-key',
          model: 'gemini-2.0-flash',
        });
        const value = result.value as Record<string, Record<string, unknown>>;

        expect(value[name]).toMatchObject({
          params,
          fn: expect.any(Function),
          annotations: { description: expect.any(String) },
          returnType: { typeName: returnTypeName },
        });
      }
    );
  });

  // AC-28: dispose() called twice does not throw
  describe('dispose lifecycle', () => {
    it('dispose can be called multiple times (idempotent)', async () => {
      const config: GeminiExtensionConfig = {
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      };

      const result = createGeminiExtension(config);

      // Call dispose twice - AC-28 (idempotent)
      await expect(result.dispose?.()).resolves.not.toThrow();
      await expect(result.dispose?.()).resolves.not.toThrow();
    });

    it('halts calls with DISPOSED and extension_disposed after dispose', async () => {
      const result = createGeminiExtension({
        api_key: 'test-key',
        model: 'gemini-2.0-flash',
      });
      const message = (result.value as Record<string, ApplicationCallable>)[
        'message'
      ]!;
      await result.dispose?.();

      const error = await expectRejectedHalt(
        Promise.resolve().then(() =>
          message.fn({ prompt: 'hello' }, createRuntimeContext())
        ),
        { code: 'DISPOSED', provider: 'gemini' }
      );

      expect(error).toBeInstanceOf(RuntimeHaltSignal);
      expect(getStatus((error as RuntimeHaltSignal).value).raw['kind']).toBe(
        'extension_disposed'
      );
    });
  });
});
