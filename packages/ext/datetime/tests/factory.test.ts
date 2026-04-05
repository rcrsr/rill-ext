/**
 * Tests for datetime extension factory.
 *
 * Covers factory creation, callable structure, config variants, and disposal.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';
import type { DatetimeExtensionConfig } from '../src/types.js';

describe('datetime extension factory', () => {
  // ============================================================
  // AC-12: Factory returns ExtensionFactoryResult with 7 callables
  // ============================================================

  describe('factory creation', () => {
    it('returns ExtensionFactoryResult with value and dispose', () => {
      const ext = createDatetimeExtension();

      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
      expect(typeof ext.dispose).toBe('function');
    });

    it('returns all 7 function keys on value dict', () => {
      const ext = createDatetimeExtension();

      expect(ext.value).toHaveProperty('iso');
      expect(ext.value).toHaveProperty('date');
      expect(ext.value).toHaveProperty('time');
      expect(ext.value).toHaveProperty('offset');
      expect(ext.value).toHaveProperty('zones');
      expect(ext.value).toHaveProperty('format');
      expect(ext.value).toHaveProperty('parse');
    });

    it('wraps each function as callable with params, fn, annotations, returnType', () => {
      const ext = createDatetimeExtension();

      // Verify shape against one representative function (iso)
      expect(ext.value.iso).toMatchObject({
        __type: 'callable',
        kind: 'application',
        params: expect.any(Array),
        fn: expect.any(Function),
        annotations: expect.objectContaining({
          description: expect.any(String),
        }),
        returnType: expect.objectContaining({
          __rill_type: true,
        }),
      });
    });

    it('wraps all 7 functions as callables', () => {
      const ext = createDatetimeExtension();
      const keys = ['iso', 'date', 'time', 'offset', 'zones', 'format', 'parse'] as const;

      for (const key of keys) {
        const fn = ext.value[key] as Record<string, unknown>;
        expect(fn, `${key} should be a callable`).toMatchObject({
          __type: 'callable',
          kind: 'application',
          fn: expect.any(Function),
          annotations: expect.objectContaining({ description: expect.any(String) }),
          returnType: expect.objectContaining({ __rill_type: true }),
        });
      }
    });
  });

  // ============================================================
  // AC-13: Factory does not register functions (returns value dict only)
  // ============================================================

  describe('no side effects', () => {
    it('creates two independent instances without interference', () => {
      const extA = createDatetimeExtension();
      const extB = createDatetimeExtension();

      expect(extA.value).not.toBe(extB.value);
      expect(extA.dispose).not.toBe(extB.dispose);
    });
  });

  // ============================================================
  // IR-8: Factory accepts empty config and undefined config
  // ============================================================

  describe('config variants', () => {
    it('accepts undefined config', () => {
      const ext = createDatetimeExtension(undefined);
      expect(ext).toBeDefined();
      expect(ext.value).toHaveProperty('iso');
    });

    it('accepts empty config object', () => {
      const config: DatetimeExtensionConfig = {};
      const ext = createDatetimeExtension(config);
      expect(ext).toBeDefined();
      expect(ext.value).toHaveProperty('iso');
    });
  });

  // ============================================================
  // AC-14: dispose() is idempotent
  // ============================================================

  describe('dispose()', () => {
    it('resolves without throw on first call', async () => {
      const ext = createDatetimeExtension();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('is idempotent: second call does not throw', async () => {
      const ext = createDatetimeExtension();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // AC-E4 / EC-4: Function call after dispose throws RILL-R004
  // ============================================================

  describe('post-dispose function calls', () => {
    it('throws RuntimeError RILL-R004 when iso is called after dispose', async () => {
      const ext = createDatetimeExtension();
      await ext.dispose!();

      const iso = ext.value.iso as { fn: (args: Record<string, unknown>) => Promise<unknown> };
      let caught: unknown;
      try {
        await iso.fn({ dt: Date.now(), zone: 'UTC' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('datetime: operation cancelled');
    });

    it('throws RuntimeError RILL-R004 when zones is called after dispose', async () => {
      const ext = createDatetimeExtension();
      await ext.dispose!();

      const zones = ext.value.zones as { fn: (args: Record<string, unknown>) => Promise<unknown> };
      let caught: unknown;
      try {
        await zones.fn({});
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('datetime: operation cancelled');
    });

    it('throws RuntimeError RILL-R004 with exact message "datetime: operation cancelled"', async () => {
      const ext = createDatetimeExtension();
      await ext.dispose!();

      const format = ext.value.format as { fn: (args: Record<string, unknown>) => Promise<unknown> };
      let caught: unknown;
      try {
        await format.fn({ dt: Date.now(), pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('datetime: operation cancelled');
    });
  });
});
