/**
 * Tests for datetime extension factory.
 *
 * Covers factory creation, callable structure, config variants, and disposal.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
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

  describe('post-dispose function calls', () => {
    const KEYS = ['iso', 'date', 'time', 'offset', 'zones', 'format', 'parse'];

    async function captureThrown(call: () => unknown): Promise<{
      threw: boolean;
      thrown: unknown;
    }> {
      try {
        await call();
      } catch (e) {
        return { threw: true, thrown: e };
      }
      return { threw: false, thrown: undefined };
    }

    it('exposes exactly the 7 expected keys', () => {
      expect(Object.keys(mk().value as Record<string, unknown>).sort()).toEqual(
        [...KEYS].sort()
      );
    });

    it('throws DISPOSED with extension_disposed for every function', async () => {
      const ext = mk();
      await ext.dispose!();
      const names = Object.keys(ext.value as Record<string, unknown>);
      expect(names.length).toBe(7);

      for (const name of names) {
        const { threw, thrown } = await captureThrown(() =>
          fnOf(ext, name).fn({}, makeRuntimeCtx())
        );
        expect(threw, `${name} should throw`).toBe(true);
        expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
        expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
        const invalid = (thrown as RuntimeHaltSignal).value;
        expect(isInvalid(invalid), `${name} invalid`).toBe(true);
        const status = getStatus(invalid);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.provider).toBe('datetime');
        expect(status.raw).toMatchObject({ kind: 'extension_disposed' });
      }
    });
  });
});

describe('datetime extension - runtime dispatch after dispose', () => {
  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = mk();
    const ctx = createRuntimeContext({
      functions: { zones: fnOf(ext, 'zones') },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('zones()'), ctx).catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const ctx = await mountDisposed();

    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { zones() }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
