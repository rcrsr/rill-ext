/**
 * Tests for crypto extension factory.
 *
 * Verifies factory creation, config validation, and function structure.
 */

import { describe, it, expect, vi } from 'vitest';
import { getStatus, isInvalid, type RillValue } from '@rcrsr/rill';
import crypto from 'node:crypto';
import { createCryptoExtension } from '../src/factory.js';
import type { CryptoExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx, fnOf } from './_setup.js';

const createCryptoExtensionT = (config?: CryptoExtensionConfig) =>
  createCryptoExtension(config ?? {}, makeFactoryCtx());

describe('crypto extension factory', () => {
  describe('factory creation', () => {
    it('creates ExtensionFactoryResult with 4 functions', () => {
      const ext = createCryptoExtensionT();

      expect(ext).toHaveProperty('value');

      expect(ext.value).toHaveProperty('hash');
      expect(ext.value).toHaveProperty('hmac');
      expect(ext.value).toHaveProperty('uuid');
      expect(ext.value).toHaveProperty('random');
    });

    it('wraps functions as callables with params and returnType', () => {
      const ext = createCryptoExtensionT();

      expect(fnOf(ext, 'hash')).toMatchObject({
        params: expect.any(Array),
        fn: expect.any(Function),
        annotations: expect.objectContaining({
          description: expect.any(String),
        }),
        returnType: expect.objectContaining({
          __rill_type: true,
          structure: { kind: 'string' },
        }),
      });
    });
  });
  describe('post-dispose calls', () => {
    it('throws #DISPOSED with extension_disposed for every function', async () => {
      const ext = createCryptoExtensionT({ hmacKey: 'k' });
      const names = Object.keys(ext.value as Record<string, unknown>);
      expect(names.sort()).toEqual(['hash', 'hmac', 'random', 'uuid']);
      const spy = vi.spyOn(crypto, 'randomUUID');
      await ext.dispose?.();

      for (const name of names) {
        const args: Record<string, RillValue> =
          name === 'random'
            ? { bytes: 4 }
            : { input: 'x', algorithm: 'sha256' };
        let thrown: unknown;
        let resolved = false;
        try {
          await fnOf(ext, name).fn(args, makeRuntimeCtx());
          resolved = true;
        } catch (e) {
          thrown = e;
        }
        expect(resolved).toBe(false);
        expect(isInvalid(thrown as RillValue)).toBe(true);
        const status = getStatus(thrown as RillValue);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.raw['kind']).toBe('extension_disposed');
        expect(status.provider).toBe('crypto');
      }
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('disposes idempotently', async () => {
      const ext = createCryptoExtensionT();
      await ext.dispose?.();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
    });
  });
});
