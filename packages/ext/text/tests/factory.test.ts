/**
 * Tests for text extension factory.
 *
 * Verifies factory creation, dispose idempotency (AC-39), and that all
 * 14 callables are registered (AC-40).
 */

import { describe, it, expect } from 'vitest';
import {
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { createTextExtension } from '../src/factory.js';
import type { TextExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

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

  describe('post-dispose behavior', () => {
    async function captureThrown(call: () => unknown): Promise<unknown> {
      let thrown: unknown;
      let resolved = false;
      try {
        await call();
        resolved = true;
      } catch (e) {
        thrown = e;
      }
      expect(resolved).toBe(false);
      return thrown;
    }

    it('lists the same functions as the expected set', () => {
      const ext = createTextExtensionT();

      expect(Object.keys(ext.value as Record<string, unknown>).sort()).toEqual(
        [...EXPECTED_FUNCTIONS].sort()
      );
    });

    it('throws #DISPOSED with extension_disposed from every function', async () => {
      const ext = createTextExtensionT();
      const dict = ext.value as Record<string, ApplicationCallable>;
      const names = Object.keys(dict);
      await ext.dispose!();

      expect(names).toHaveLength(EXPECTED_FUNCTIONS.length);
      for (const name of names) {
        // Valid arguments: success would resolve, so a throw proves the
        // guard ran before any work.
        const args: Record<string, RillValue> =
          name === 'window'
            ? { text: 'a b c', size: 2, overlap: 0 }
            : name === 'truncate'
              ? { text: 'abc', max: 2, ellipsis: '' }
              : name === 'html_to_text' ||
                  name === 'html_to_markdown' ||
                  name === 'extract_content'
                ? { html: '<p>x</p>' }
                : { text: 'x' };
        const thrown = await captureThrown(() =>
          dict[name]!.fn(args, makeRuntimeCtx())
        );

        expect(isInvalid(thrown as RillValue)).toBe(true);
        const status = getStatus(thrown as RillValue);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.provider).toBe('text');
        expect(status.raw['kind']).toBe('extension_disposed');
      }
    });

    it('keeps returning results before dispose', async () => {
      const ext = createTextExtensionT();
      const dict = ext.value as Record<string, ApplicationCallable>;

      const result = await dict['dedent']!.fn(
        { text: '  x' },
        makeRuntimeCtx()
      );

      expect(isInvalid(result)).toBe(false);
    });
  });
});
