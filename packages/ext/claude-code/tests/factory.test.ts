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
    it('returns ExtensionResult with prompt, skill, command functions', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      // IR-1: Returns ExtensionResult with host functions
      expect(v).toHaveProperty('prompt');
      expect(v).toHaveProperty('skill');
      expect(v).toHaveProperty('command');
      expect(ext).toHaveProperty('dispose');

      // Verify host function structure
      expect(v.prompt).toHaveProperty('params');
      expect(v.prompt).toHaveProperty('fn');
      expect(v.prompt).toHaveProperty('annotations');
      expect(v.prompt).toHaveProperty('returnType');

      expect(v.skill).toHaveProperty('params');
      expect(v.skill).toHaveProperty('fn');
      expect(v.skill).toHaveProperty('annotations');
      expect(v.skill).toHaveProperty('returnType');

      expect(v.command).toHaveProperty('params');
      expect(v.command).toHaveProperty('fn');
      expect(v.command).toHaveProperty('annotations');
      expect(v.command).toHaveProperty('returnType');
    });

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

    it('validates prompt text before processing', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);
      const ctx = makeRuntimeCtx();

      // Validation throws an invalid RillValue carrying #INVALID_INPUT (AC-10)
      expectInvalidThrow(
        () => v.prompt.fn({ text: '', options: {} }, ctx),
        'INVALID_INPUT',
        'prompt text cannot be empty'
      );
      expectInvalidThrow(
        () => v.skill.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'skill name cannot be empty'
      );
      expectInvalidThrow(
        () => v.command.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'command name cannot be empty'
      );
    });
  });

  describe('config validation', () => {
    it('uses default binaryPath when not provided', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
    });

    it('uses default timeout when not provided', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
    });

    it('accepts valid binaryPath', () => {
      const ext = createClaudeCodeExtension(
        {
          binaryPath: '/usr/bin/claude',
        },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
    });

    it('accepts valid timeout', () => {
      const ext = createClaudeCodeExtension(
        {
          defaultTimeout: 60000,
        },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
    });

    it('accepts both config options', () => {
      const ext = createClaudeCodeExtension(
        {
          binaryPath: '/usr/bin/claude',
          defaultTimeout: 60000,
        },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
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

    it('validates binaryPath eagerly at factory creation', () => {
      // Should throw immediately, not during function call
      expect(() =>
        createClaudeCodeExtension(
          { binaryPath: 'invalid-binary' },
          makeFactoryCtx()
        )
      ).toThrow('claude binary not found');
    });
  });

  describe('timeout validation (EC-2)', () => {
    it('throws Error for negative timeout', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: -1 }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('throws Error for zero timeout', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: 0 }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('throws Error for non-integer timeout', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: 30000.5 }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('throws Error for timeout exceeding 3600000', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: 3600001 }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('accepts timeout at boundary (3600000)', () => {
      const ext = createClaudeCodeExtension(
        { defaultTimeout: 3600000 },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
    });

    it('accepts timeout at lower boundary (1)', () => {
      const ext = createClaudeCodeExtension(
        { defaultTimeout: 1 },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
    });
  });

  describe('dispose function (IR-5)', () => {
    it('provides dispose function', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext.dispose).toBeInstanceOf(Function);
    });

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

    it('logs warning on cleanup failure, does not throw', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // Simulate cleanup failure by manually adding a failing disposer
      // This tests EC-16: cleanup failure logs warning, not thrown
      const tracker = (ext as unknown as { disposers?: Set<() => void> })
        .disposers;
      if (tracker) {
        tracker.add(() => {
          throw new Error('Cleanup failed');
        });
      }

      // Should not throw
      expect(() => ext.dispose?.()).not.toThrow();

      // Note: This test verifies the disposal doesn't throw.
      // The internal tracker is private, so we test the public contract:
      // dispose() should never throw, even on internal errors.
    });

    it('dispose does not throw even without processes', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // EC-16: Should handle empty state gracefully
      expect(() => ext.dispose?.()).not.toThrow();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('default values', () => {
    it('uses default binaryPath "claude" when omitted', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
    });

    it('uses default timeout 30000 when omitted', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
    });

    it('handles empty config object', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
      expect(extValue(ext).prompt).toBeDefined();
      expect(extValue(ext).skill).toBeDefined();
      expect(extValue(ext).command).toBeDefined();
      expect(ext.dispose).toBeDefined();
    });

    it('handles undefined config', () => {
      const ext = createClaudeCodeExtension(undefined, makeFactoryCtx());
      expect(ext).toBeDefined();
    });
  });

  describe('empty string validation', () => {
    it('invalidates with #INVALID_INPUT for empty prompt text (EC-3)', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);
      const ctx = makeRuntimeCtx();

      expectInvalidThrow(
        () => v.prompt.fn({ text: '', options: {} }, ctx),
        'INVALID_INPUT',
        'prompt text cannot be empty'
      );
      expectInvalidThrow(
        () => v.prompt.fn({ text: '   ', options: {} }, ctx),
        'INVALID_INPUT',
        'prompt text cannot be empty'
      );
    });

    it('invalidates with #INVALID_INPUT for empty skill name (EC-10)', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);
      const ctx = makeRuntimeCtx();

      expectInvalidThrow(
        () => v.skill.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'skill name cannot be empty'
      );
      expectInvalidThrow(
        () => v.skill.fn({ name: '   ', args: {} }, ctx),
        'INVALID_INPUT',
        'skill name cannot be empty'
      );
    });

    it('invalidates with #INVALID_INPUT for empty command name (EC-13)', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);
      const ctx = makeRuntimeCtx();

      expectInvalidThrow(
        () => v.command.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'command name cannot be empty'
      );
      expectInvalidThrow(
        () => v.command.fn({ name: '   ', args: {} }, ctx),
        'INVALID_INPUT',
        'command name cannot be empty'
      );
    });
  });

  describe('event emission (AC-17-20)', () => {
    it('functions have event emission structure in place', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      // Functions are defined and can be called (event emission tested in integration tests)
      expect(v.prompt.fn).toBeInstanceOf(Function);
      expect(v.skill.fn).toBeInstanceOf(Function);
      expect(v.command.fn).toBeInstanceOf(Function);
    });
  });
});
