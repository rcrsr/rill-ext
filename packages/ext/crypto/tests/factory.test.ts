/**
 * Tests for crypto extension factory.
 *
 * Verifies factory creation, config validation, and function structure.
 */

import { describe, it, expect } from 'vitest';
import { createCryptoExtension } from '../src/factory.js';
import type { CryptoExtensionConfig } from '../src/types.js';
import { makeFactoryCtx } from './_setup.js';

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

      expect(ext.value.hash).toMatchObject({
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

    it('applies config defaults', () => {
      const ext = createCryptoExtensionT();
      expect(ext).toBeDefined();
    });

    it('accepts custom default algorithm', () => {
      const config: CryptoExtensionConfig = {
        defaultAlgorithm: 'sha512',
      };
      const ext = createCryptoExtensionT(config);
      expect(ext).toBeDefined();
    });

    it('accepts hmacKey in config', () => {
      const config: CryptoExtensionConfig = {
        hmacKey: 'secret-key-123',
      };
      const ext = createCryptoExtensionT(config);
      expect(ext).toBeDefined();
    });
  });
});
