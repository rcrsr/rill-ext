/**
 * Tests for datetime extension factory.
 *
 * Covers factory creation, callable structure, config variants, and disposal.
 */

import { describe, it, expect, vi } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';
import type { DatetimeExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx, fnOf } from './_setup.js';

function mk(config?: DatetimeExtensionConfig) {
  return createDatetimeExtension(config ?? {}, makeFactoryCtx());
}

describe('datetime extension factory', () => {
  // ============================================================
  // AC-12: Factory returns ExtensionFactoryResult with 7 callables
  // ============================================================

  describe('factory creation', () => {
    it('returns all 7 function keys on value dict', () => {
      const ext = mk();

      expect(ext.value).toHaveProperty('iso');
      expect(ext.value).toHaveProperty('date');
      expect(ext.value).toHaveProperty('time');
      expect(ext.value).toHaveProperty('offset');
      expect(ext.value).toHaveProperty('zones');
      expect(ext.value).toHaveProperty('format');
      expect(ext.value).toHaveProperty('parse');
    });

    it('wraps all 7 functions as callables', () => {
      const ext = mk();
      const keys = [
        'iso',
        'date',
        'time',
        'offset',
        'zones',
        'format',
        'parse',
      ] as const;

      for (const key of keys) {
        const fn = fnOf(ext, key);
        expect(fn, `${key} should be a callable`).toMatchObject({
          __type: 'callable',
          kind: 'application',
          fn: expect.any(Function),
          annotations: expect.objectContaining({
            description: expect.any(String),
          }),
          returnType: expect.objectContaining({ __rill_type: true }),
        });
      }
    });
  });

  // ============================================================
  // AC-13: Factory does not register functions (returns value dict only)
  // ============================================================

  describe('no side effects', () => {
    it('does not register error codes at factory time', () => {
      const registerErrorCode = vi.fn<() => void>();

      createDatetimeExtension({}, { ...makeFactoryCtx(), registerErrorCode });

      expect(registerErrorCode).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // AC-14: dispose() is idempotent
  // ============================================================

  describe('dispose()', () => {
    it('is idempotent: second call does not throw', async () => {
      const ext = mk();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // AC-E4 / EC-4: Function call after dispose returns invalid value
  // ============================================================

  describe('post-dispose function calls', () => {
    it.each([
      { name: 'iso', args: { dt: 0, zone: 'UTC' } },
      { name: 'zones', args: {} },
      { name: 'format', args: { dt: 0, pattern: 'YYYY-MM-DD' } },
    ])(
      'returns invalid value with message "datetime: operation cancelled" when $name is called after dispose',
      async ({ name, args }) => {
        const ext = mk();
        await ext.dispose!();

        const result = await fnOf(ext, name).fn(args, makeRuntimeCtx());
        const status = getStatus(result);
        expect(status.code.name).toBe('INVALID_INPUT');
        expect(status.message).toMatch(/datetime: operation cancelled/);
      }
    );
  });
});
