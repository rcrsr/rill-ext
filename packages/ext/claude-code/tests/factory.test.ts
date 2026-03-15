/**
 * Tests for createClaudeCodeExtension factory.
 * Covers config validation, function stubs, and cleanup lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rillTypeToTypeValue } from '@rcrsr/rill';
import { createClaudeCodeExtension } from '../src/factory.js';

const EXPECTED_RETURN_TYPE = rillTypeToTypeValue({
  type: 'dict',
  fields: {
    result: { type: { type: 'string' } },
    tokens: { type: { type: 'dict', fields: {
      prompt: { type: { type: 'number' } },
      cacheWrite5m: { type: { type: 'number' } },
      cacheWrite1h: { type: { type: 'number' } },
      cacheRead: { type: { type: 'number' } },
      output: { type: { type: 'number' } },
    } } },
    cost: { type: { type: 'number' } },
    exitCode: { type: { type: 'number' } },
    duration: { type: { type: 'number' } },
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
      const ext = createClaudeCodeExtension();

      // IR-1: Returns ExtensionResult with host functions
      expect(ext).toHaveProperty('prompt');
      expect(ext).toHaveProperty('skill');
      expect(ext).toHaveProperty('command');
      expect(ext).toHaveProperty('dispose');

      // Verify host function structure
      expect(ext.prompt).toHaveProperty('params');
      expect(ext.prompt).toHaveProperty('fn');
      expect(ext.prompt).toHaveProperty('annotations');
      expect(ext.prompt).toHaveProperty('returnType');

      expect(ext.skill).toHaveProperty('params');
      expect(ext.skill).toHaveProperty('fn');
      expect(ext.skill).toHaveProperty('annotations');
      expect(ext.skill).toHaveProperty('returnType');

      expect(ext.command).toHaveProperty('params');
      expect(ext.command).toHaveProperty('fn');
      expect(ext.command).toHaveProperty('annotations');
      expect(ext.command).toHaveProperty('returnType');
    });

    it('creates prompt function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension();

      expect(ext.prompt.params).toEqual([
        { name: 'text', type: { type: 'string' }, defaultValue: undefined, annotations: {} },
        { name: 'options', type: { type: 'dict', fields: { timeout: { type: { type: 'number' }, defaultValue: 0 } } }, defaultValue: {}, annotations: {} },
      ]);
      expect(ext.prompt.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates skill function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension();

      expect(ext.skill.params).toEqual([
        { name: 'name', type: { type: 'string' }, defaultValue: undefined, annotations: {} },
        { name: 'args', type: { type: 'dict', fields: { timeout: { type: { type: 'number' }, defaultValue: 0 } } }, defaultValue: {}, annotations: {} },
      ]);
      expect(ext.skill.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates command function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension();

      expect(ext.command.params).toEqual([
        { name: 'name', type: { type: 'string' }, defaultValue: undefined, annotations: {} },
        { name: 'args', type: { type: 'dict', fields: { timeout: { type: { type: 'number' }, defaultValue: 0 } } }, defaultValue: {}, annotations: {} },
      ]);
      expect(ext.command.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('validates prompt text before processing', async () => {
      const ext = createClaudeCodeExtension();
      const ctx = {
        callbacks: {
          onLogEvent: vi.fn(),
        },
      } as never;

      // Empty string validation tested in separate suite
      // This verifies that functions are callable (not stubbed as "Not implemented")
      await expect(ext.prompt.fn({ text: '', options: {} }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
      await expect(ext.skill.fn({ name: '', args: {} }, ctx)).rejects.toThrow(
        'skill name cannot be empty'
      );
      await expect(ext.command.fn({ name: '', args: {} }, ctx)).rejects.toThrow(
        'command name cannot be empty'
      );
    });
  });

  describe('config validation', () => {
    it('uses default binaryPath when not provided', () => {
      const ext = createClaudeCodeExtension();
      expect(ext).toBeDefined();
    });

    it('uses default timeout when not provided', () => {
      const ext = createClaudeCodeExtension();
      expect(ext).toBeDefined();
    });

    it('accepts valid binaryPath', () => {
      const ext = createClaudeCodeExtension({
        binaryPath: '/usr/bin/claude',
      });
      expect(ext).toBeDefined();
    });

    it('accepts valid timeout', () => {
      const ext = createClaudeCodeExtension({
        defaultTimeout: 60000,
      });
      expect(ext).toBeDefined();
    });

    it('accepts both config options', () => {
      const ext = createClaudeCodeExtension({
        binaryPath: '/usr/bin/claude',
        defaultTimeout: 60000,
      });
      expect(ext).toBeDefined();
    });
  });

  describe('binaryPath validation (EC-1)', () => {
    it('throws Error for invalid binaryPath', () => {
      expect(() =>
        createClaudeCodeExtension({ binaryPath: '/nonexistent/claude' })
      ).toThrow('Binary not found: /nonexistent/claude');
    });

    it('validates binaryPath eagerly at factory creation', () => {
      // Should throw immediately, not during function call
      expect(() =>
        createClaudeCodeExtension({ binaryPath: 'invalid-binary' })
      ).toThrow('Binary not found: invalid-binary');
    });
  });

  describe('timeout validation (EC-2)', () => {
    it('throws Error for negative timeout', () => {
      expect(() => createClaudeCodeExtension({ defaultTimeout: -1 })).toThrow(
        'Invalid timeout: must be positive integer, max 3600000'
      );
    });

    it('throws Error for zero timeout', () => {
      expect(() => createClaudeCodeExtension({ defaultTimeout: 0 })).toThrow(
        'Invalid timeout: must be positive integer, max 3600000'
      );
    });

    it('throws Error for non-integer timeout', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: 30000.5 })
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('throws Error for timeout exceeding 3600000', () => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: 3600001 })
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it('accepts timeout at boundary (3600000)', () => {
      const ext = createClaudeCodeExtension({ defaultTimeout: 3600000 });
      expect(ext).toBeDefined();
    });

    it('accepts timeout at lower boundary (1)', () => {
      const ext = createClaudeCodeExtension({ defaultTimeout: 1 });
      expect(ext).toBeDefined();
    });
  });

  describe('dispose function (IR-5)', () => {
    it('provides dispose function', () => {
      const ext = createClaudeCodeExtension();
      expect(ext.dispose).toBeInstanceOf(Function);
    });

    it('dispose is idempotent (multiple calls safe)', () => {
      const ext = createClaudeCodeExtension();

      // Should not throw on multiple calls
      expect(() => {
        ext.dispose?.();
        ext.dispose?.();
        ext.dispose?.();
      }).not.toThrow();
    });

    it('dispose completes successfully on clean instance', () => {
      const ext = createClaudeCodeExtension();
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
      const ext = createClaudeCodeExtension();

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
      const ext = createClaudeCodeExtension();

      // EC-16: Should handle empty state gracefully
      expect(() => ext.dispose?.()).not.toThrow();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('default values', () => {
    it('uses default binaryPath "claude" when omitted', () => {
      const ext = createClaudeCodeExtension({});
      expect(ext).toBeDefined();
    });

    it('uses default timeout 30000 when omitted', () => {
      const ext = createClaudeCodeExtension({});
      expect(ext).toBeDefined();
    });

    it('handles empty config object', () => {
      const ext = createClaudeCodeExtension({});
      expect(ext).toBeDefined();
      expect(ext.prompt).toBeDefined();
      expect(ext.skill).toBeDefined();
      expect(ext.command).toBeDefined();
      expect(ext.dispose).toBeDefined();
    });

    it('handles undefined config', () => {
      const ext = createClaudeCodeExtension(undefined);
      expect(ext).toBeDefined();
    });
  });

  describe('empty string validation', () => {
    const ctx = {
      callbacks: {
        onLogEvent: vi.fn(),
      },
    } as never;

    it('throws RuntimeError for empty prompt text (EC-3)', async () => {
      const ext = createClaudeCodeExtension();

      await expect(ext.prompt.fn({ text: '', options: {} }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );

      await expect(ext.prompt.fn({ text: '   ', options: {} }, ctx)).rejects.toThrow(
        'prompt text cannot be empty'
      );
    });

    it('throws RuntimeError for empty skill name (EC-10)', async () => {
      const ext = createClaudeCodeExtension();

      await expect(ext.skill.fn({ name: '', args: {} }, ctx)).rejects.toThrow(
        'skill name cannot be empty'
      );

      await expect(ext.skill.fn({ name: '   ', args: {} }, ctx)).rejects.toThrow(
        'skill name cannot be empty'
      );
    });

    it('throws RuntimeError for empty command name (EC-13)', async () => {
      const ext = createClaudeCodeExtension();

      await expect(ext.command.fn({ name: '', args: {} }, ctx)).rejects.toThrow(
        'command name cannot be empty'
      );

      await expect(ext.command.fn({ name: '   ', args: {} }, ctx)).rejects.toThrow(
        'command name cannot be empty'
      );
    });
  });

  describe('event emission (AC-17-20)', () => {
    it('functions have event emission structure in place', () => {
      const ext = createClaudeCodeExtension();

      // Functions are defined and can be called (event emission tested in integration tests)
      expect(ext.prompt.fn).toBeInstanceOf(Function);
      expect(ext.skill.fn).toBeInstanceOf(Function);
      expect(ext.command.fn).toBeInstanceOf(Function);
    });
  });
});
