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
    it('registers all 14 callables on result.value [AC-40]', () => {
      const ext = createTextExtensionT();

      for (const name of EXPECTED_FUNCTIONS) {
        expect(ext.value).toHaveProperty(name);
      }

      expect(Object.keys(ext.value as Record<string, unknown>)).toHaveLength(
        EXPECTED_FUNCTIONS.length
      );
    });
  });

  describe('dispose idempotency [AC-39]', () => {
    it('calling dispose() twice does not throw', async () => {
      const ext = createTextExtensionT();

      const dispose = ext.dispose;
      expect(dispose).toBeDefined();

      await expect(dispose!()).resolves.toBeUndefined();
      await expect(dispose!()).resolves.toBeUndefined();
    });
  });
});
