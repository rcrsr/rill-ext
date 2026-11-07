/**
 * Tests for createClaudeCodeExtension factory.
 * Covers config validation, function stubs, and cleanup lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { structureToTypeValue } from '@rcrsr/rill';
import { createClaudeCodeExtension } from '../src/factory.js';
import {
  makeFactoryCtx,
  makeRuntimeCtx,
  expectInvalidThrow,
  extValue,
} from './_helpers.js';

const EXPECTED_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'string' },
  ret: {
    kind: 'dict',
    fields: {
      result: { type: { kind: 'string' } },
      tokens: {
        type: {
          kind: 'dict',
          fields: {
            prompt: { type: { kind: 'number' } },
            cache_write_5m: { type: { kind: 'number' } },
            cache_write_1h: { type: { kind: 'number' } },
            cache_read: { type: { kind: 'number' } },
            output: { type: { kind: 'number' } },
          },
        },
      },
      cost: { type: { kind: 'number' } },
      exit_code: { type: { kind: 'number' } },
      duration: { type: { kind: 'number' } },
    },
  },
});

// Mock which module
vi.mock('which', () => ({
  default: {
    sync: vi.fn((path: string) => {
      if (path === 'claude' || path === '/usr/bin/claude') {
        return path;
      }
      const error = new Error('not found') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    }),
  },
}));

// Mock process module to avoid node-pty dependency
vi.mock('../src/process.js', () => ({
  spawnClaudeCli: vi.fn(),
}));

describe('createClaudeCodeExtension', () => {
  describe('factory return value', () => {
    it('creates prompt function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.prompt.params).toEqual([
        {
          name: 'text',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'options',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.prompt.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates skill function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.skill.params).toEqual([
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'args',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.skill.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates command function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.command.params).toEqual([
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'args',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.command.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });
  });

  describe('binaryPath validation (EC-1)', () => {
    it('throws RuntimeError RILL-R001 for invalid binaryPath', () => {
      expect(() =>
        createClaudeCodeExtension(
          { binaryPath: '/nonexistent/claude' },
          makeFactoryCtx()
        )
      ).toThrow('claude binary not found');
    });
  });

  describe('timeout validation', () => {
    it.each([
      { label: 'negative', timeout: -1 },
      { label: 'negative large', timeout: -5000 },
      { label: 'zero', timeout: 0 },
      { label: 'decimal', timeout: 2500.75 },
      { label: 'fractional millisecond', timeout: 10000.1 },
      { label: 'just above max', timeout: 3600001 },
      { label: 'far above max', timeout: 5000000 },
    ])('throws for $label timeout $timeout', ({ timeout }) => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: timeout }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it.each([
      { label: 'lower boundary', timeout: 1 },
      { label: 'upper boundary', timeout: 3600000 },
    ])('accepts $label timeout $timeout', ({ timeout }) => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: timeout }, makeFactoryCtx())
      ).not.toThrow();
    });
  });

  describe('dispose function', () => {
    it('dispose is idempotent (multiple calls safe)', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // Should not throw on multiple calls
      expect(() => {
        ext.dispose?.();
        ext.dispose?.();
        ext.dispose?.();
      }).not.toThrow();
    });

    it('dispose completes successfully on clean instance', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(() => ext.dispose?.()).not.toThrow();
    });
  });

  describe('cleanup failure handling (EC-16)', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('dispose does not throw even without processes', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // EC-16: Should handle empty state gracefully
      expect(() => ext.dispose?.()).not.toThrow();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('default values', () => {
    it('handles undefined config', () => {
      expect(() =>
        createClaudeCodeExtension(undefined, makeFactoryCtx())
      ).not.toThrow();
    });
  });

  describe('empty input validation', () => {
    const BLANK_INPUTS = [
      { label: 'empty string', value: '' },
      { label: 'spaces', value: '   ' },
      { label: 'tabs and newlines', value: '\t\n  ' },
    ];
    const CASES = BLANK_INPUTS.flatMap(({ label, value }) => [
      {
        fn: 'prompt' as const,
        label,
        args: { text: value, options: {} },
        message: 'prompt text cannot be empty',
      },
      {
        fn: 'skill' as const,
        label,
        args: { name: value, args: {} },
        message: 'skill name cannot be empty',
      },
      {
        fn: 'command' as const,
        label,
        args: { name: value, args: {} },
        message: 'command name cannot be empty',
      },
    ]);

    it.each(CASES)(
      'invalidates $fn with #INVALID_INPUT for $label',
      ({ fn, args, message }) => {
        const v = extValue(createClaudeCodeExtension({}, makeFactoryCtx()));
        const ctx = makeRuntimeCtx();

        expectInvalidThrow(() => v[fn].fn(args, ctx), 'INVALID_INPUT', message);
      }
    );
  });
});
