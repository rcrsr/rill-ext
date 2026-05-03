/**
 * Tests for text extension factory.
 *
 * Verifies factory creation, dispose idempotency (AC-39), and that all
 * 14 callables are registered (AC-40).
 */

import { describe, it, expect } from 'vitest';
import { createTextExtension } from '../src/factory.js';
import type { TextExtensionConfig } from '../src/types.js';
import { makeFactoryCtx } from './_setup.js';

const EXPECTED_FUNCTIONS = [
  'html_to_text',
  'html_to_markdown',
  'extract_content',
  'decode_entities',
  'decode_quoted_printable',
  'strip_diacritics',
  'collapse_whitespace',
  'dedent',
  'trim_lines',
  'extract_urls',
  'extract_emails',
  'split_paragraphs',
  'window',
  'truncate',
] as const;

const createTextExtensionT = (config?: TextExtensionConfig) =>
  createTextExtension(config ?? {}, makeFactoryCtx());

describe('text extension factory', () => {
  describe('factory creation', () => {
    it('returns ExtensionFactoryResult with value and dispose', () => {
      const ext = createTextExtensionT();

      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
      expect(typeof ext.dispose).toBe('function');
    });

    it('registers all 14 callables on result.value [AC-40]', () => {
      const ext = createTextExtensionT();

      for (const name of EXPECTED_FUNCTIONS) {
        expect(ext.value).toHaveProperty(name);
      }

      expect(Object.keys(ext.value as Record<string, unknown>)).toHaveLength(
        EXPECTED_FUNCTIONS.length,
      );
    });

    it('accepts empty config object (zero-config init)', () => {
      const ext = createTextExtensionT({});
      expect(ext).toBeDefined();
    });

    it('accepts no arguments', () => {
      const ext = createTextExtension({}, makeFactoryCtx());
      expect(ext).toBeDefined();
    });
  });

  describe('callable shape contract', () => {
    it('each callable carries params, fn, annotations, and returnType', () => {
      const ext = createTextExtensionT();
      const value = ext.value as Record<string, unknown>;

      for (const name of EXPECTED_FUNCTIONS) {
        const callable = value[name];
        expect(callable, `${name} should have params`).toMatchObject({
          params: expect.any(Array),
          fn: expect.any(Function),
          annotations: expect.objectContaining({
            description: expect.any(String),
          }),
          returnType: expect.objectContaining({
            __rill_type: true,
          }),
        });
      }
    });
  });

  describe('dispose idempotency [AC-39]', () => {
    it('calling dispose() twice does not throw', async () => {
      const ext = createTextExtensionT();

      await expect(ext.dispose()).resolves.toBeUndefined();
      await expect(ext.dispose()).resolves.toBeUndefined();
    });
  });
});
