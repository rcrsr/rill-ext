/**
 * Factory validation tests
 * Validates config validation and lifecycle management
 */

import { describe, it, expect } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  type ApplicationCallable,
  type RuntimeHaltSignal,
} from '@rcrsr/rill';
import { createAnthropicExtension } from '../src/factory.js';
import type { AnthropicExtensionConfig } from '../src/types.js';
import { expectThrowHalt } from './_halt-helpers.js';

// ============================================================
// VALIDATION TESTS
// ============================================================

describe('createAnthropicExtension', () => {
  describe('configuration validation', () => {
    it.each([
      {
        label: 'a missing api_key',
        config: { model: 'claude-sonnet-4-5-20250929' },
        message: 'api_key is required',
      },
      {
        label: 'an empty api_key',
        config: { api_key: '', model: 'claude-sonnet-4-5-20250929' },
        message: 'api_key cannot be empty',
      },
      {
        label: 'a missing model',
        config: { api_key: 'test-key' },
        message: 'model is required',
      },
      {
        label: 'an empty model',
        config: { api_key: 'test-key', model: '' },
        message: 'model is required',
      },
      {
        label: 'a temperature below 0',
        config: {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
          temperature: -0.1,
        },
        message: 'temperature must be between 0 and 2',
      },
      {
        label: 'a temperature above 2',
        config: {
          api_key: 'test-key',
          model: 'claude-sonnet-4-5-20250929',
          temperature: 2.1,
        },
        message: 'temperature must be between 0 and 2',
      },
    ])('throws for $label', ({ config, message }) => {
      expect(() =>
        createAnthropicExtension(config as AnthropicExtensionConfig)
      ).toThrow(message);
    });

    it.each([
      { label: 'a temperature of 0', temperature: 0.0 },
      { label: 'a temperature of 2', temperature: 2.0 },
      { label: 'a temperature of 0.7', temperature: 0.7 },
      { label: 'an omitted temperature', temperature: undefined },
    ])('accepts $label', ({ temperature }) => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
        temperature,
      };

      expect(() => createAnthropicExtension(config)).not.toThrow();
    });
  });

  // AC-1: Factory returns ExtensionFactoryResult with 5 functions in value dict
  describe('extension result structure', () => {
    it('message callable has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);
      const value = result.value as Record<string, Record<string, unknown>>;

      // prompt is now a single `any` param (accepts string or list of message dicts)
      expect(value['message']).toMatchObject({
        params: [
          { name: 'prompt', type: { kind: 'any' }, defaultValue: undefined },
        ],
        fn: expect.any(Function),
        annotations: { description: expect.any(String) },
        returnType: { typeName: 'stream' },
      });
    });

    it('embed callable has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);
      const value = result.value as Record<string, Record<string, unknown>>;

      expect(value['embed']).toMatchObject({
        params: [
          {
            name: 'text',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: expect.any(Function),
        annotations: { description: expect.any(String) },
        returnType: {
          typeName: 'vector',
          structure: { kind: 'vector' },
        },
      });
    });

    it('embed_batch callable has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);
      const value = result.value as Record<string, Record<string, unknown>>;

      expect(value['embed_batch']).toMatchObject({
        params: [
          {
            name: 'texts',
            type: { kind: 'list' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: expect.any(Function),
        annotations: { description: expect.any(String) },
        returnType: {
          typeName: 'list',
          structure: { kind: 'list', element: { kind: 'vector' } },
        },
      });
    });

    it('tool_loop callable has correct structure', () => {
      const config: AnthropicExtensionConfig = {
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      };

      const result = createAnthropicExtension(config);
      const value = result.value as Record<string, Record<string, unknown>>;

      // max_turns is now positional (number, default 0); options dict removed
      expect(value['tool_loop']).toMatchObject({
        params: [
          { name: 'prompt', type: { kind: 'any' }, defaultValue: undefined },
          {
            name: 'tools',
            type: { kind: 'dict', valueType: { kind: 'closure' } },
            defaultValue: undefined,
          },
          { name: 'max_turns', type: { kind: 'number' }, defaultValue: 0 },
        ],
        fn: expect.any(Function),
        annotations: { description: expect.any(String) },
      });
    });
  });

  // AC-28: dispose() called twice does not throw
  describe('dispose lifecycle', () => {
    it('disposes idempotently and halts calls with #DISPOSED afterwards', async () => {
      const result = createAnthropicExtension({
        api_key: 'test-key',
        model: 'claude-sonnet-4-5-20250929',
      });
      const value = result.value as Record<string, ApplicationCallable>;

      await expect(result.dispose?.()).resolves.toBeUndefined();
      await expect(result.dispose?.()).resolves.toBeUndefined();

      const thrown = expectThrowHalt(
        () => value['message']!.fn({ prompt: 'Hello' }, createRuntimeContext()),
        { code: 'DISPOSED' }
      );
      expect(getStatus((thrown as RuntimeHaltSignal).value).raw).toMatchObject({
        kind: 'extension_disposed',
      });
    });
  });
});
