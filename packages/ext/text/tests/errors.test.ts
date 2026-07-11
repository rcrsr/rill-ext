/**
 * Error contract tests for text extension.
 *
 * Covers EC-1 through EC-7 and AC-23 through AC-28.
 * Each test verifies ctx.invalidate is called with:
 *   - meta.code === 'INVALID_INPUT'
 *   - meta.provider === 'text'
 *   - meta.raw.kind === <expected kind>
 */

import { describe, it, expect, vi } from 'vitest';
import { createTextExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

// ---------------------------------------------------------------------------
// Shared extension instance — stateless, one instance covers all tests.
// ---------------------------------------------------------------------------

const ext = createTextExtension({}, makeFactoryCtx());
const val = ext.value as Record<
  string,
  {
    fn: (
      args: Record<string, unknown>,
      ctx: ReturnType<typeof makeRuntimeCtx>
    ) => Promise<unknown>;
  }
>;

// Helper: extract function by name
function fn(name: string) {
  return val[name].fn;
}

// ---------------------------------------------------------------------------
// EC-1 / AC-23: html_to_text — non-bool include_links
// ---------------------------------------------------------------------------

describe('html_to_text errors', () => {
  it('EC-1 / AC-23: rejects non-bool include_links with INVALID_INPUT / invalid_option_type', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('html_to_text')({ html: '<p>x</p>', include_links: 'maybe' }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_option_type' });
  });

  // EC-7: word_wrap_width: 0 → invalid_word_wrap_width
  it('EC-7: rejects word_wrap_width: 0 with INVALID_INPUT / invalid_word_wrap_width', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('html_to_text')({ html: '<p>x</p>', word_wrap_width: 0 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_word_wrap_width' });
  });

  // EC-7: word_wrap_width: -1 → invalid_word_wrap_width
  it('EC-7: rejects word_wrap_width: -1 with INVALID_INPUT / invalid_word_wrap_width', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('html_to_text')({ html: '<p>x</p>', word_wrap_width: -1 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_word_wrap_width' });
  });
});

// ---------------------------------------------------------------------------
// EC-2 / AC-24, EC-3 / AC-25: truncate — negative or zero max
// ---------------------------------------------------------------------------

describe('truncate errors', () => {
  it('EC-2 / AC-24: rejects max: -5 with INVALID_INPUT / invalid_max', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('truncate')({ text: 'hello', max: -5 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_max' });
  });

  it('EC-3 / AC-25: rejects max: 0 with INVALID_INPUT / invalid_max', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('truncate')({ text: 'hello', max: 0 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_max' });
  });
});

// ---------------------------------------------------------------------------
// EC-4 / AC-26, EC-5 / AC-27: window — negative size or zero step
// ---------------------------------------------------------------------------

describe('window errors', () => {
  it('EC-4 / AC-26: rejects size: -10 with INVALID_INPUT / invalid_window_size', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('window')({ text: 'hello', size: -10, step: 5 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_window_size' });
  });

  it('EC-5 / AC-27: rejects step: 0 with INVALID_INPUT / invalid_window_step', async () => {
    const ctx = makeRuntimeCtx();
    const invalidateSpy = vi.spyOn(ctx, 'invalidate');

    await fn('window')({ text: 'hello', size: 5, step: 0 }, ctx);

    expect(invalidateSpy).toHaveBeenCalled();
    const [, meta] = invalidateSpy.mock.calls[0];
    expect(meta.code).toBe('INVALID_INPUT');
    expect(meta.provider).toBe('text');
    expect(meta.raw).toMatchObject({ kind: 'invalid_window_step' });
  });
});

// ---------------------------------------------------------------------------
// EC-6 / AC-28: non-string input across all 14 functions
//
// Functions that accept `html` as the main input: html_to_text,
// html_to_markdown, extract_content.
// All others accept `text`.
// ---------------------------------------------------------------------------

type FnEntry = {
  name: string;
  argKey: 'html' | 'text';
  extraArgs?: Record<string, unknown>;
};

const HTML_FUNCTIONS: FnEntry[] = [
  { name: 'html_to_text', argKey: 'html' },
  { name: 'html_to_markdown', argKey: 'html' },
  { name: 'extract_content', argKey: 'html' },
];

const TEXT_FUNCTIONS: FnEntry[] = [
  { name: 'decode_entities', argKey: 'text' },
  { name: 'decode_quoted_printable', argKey: 'text' },
  { name: 'strip_diacritics', argKey: 'text' },
  { name: 'collapse_whitespace', argKey: 'text' },
  { name: 'dedent', argKey: 'text' },
  { name: 'trim_lines', argKey: 'text' },
  { name: 'extract_urls', argKey: 'text' },
  { name: 'extract_emails', argKey: 'text' },
  { name: 'split_paragraphs', argKey: 'text' },
  { name: 'window', argKey: 'text', extraArgs: { size: 5, step: 5 } },
  { name: 'truncate', argKey: 'text', extraArgs: { max: 10 } },
];

const ALL_FUNCTIONS: FnEntry[] = [...HTML_FUNCTIONS, ...TEXT_FUNCTIONS];

const INVALID_INPUTS: Array<[string, unknown]> = [
  ['number 42', 42],
  ['null', null],
  ['undefined', undefined],
  ['list []', []],
  ['dict {}', {}],
];

describe('non-string input across all functions (EC-6 / AC-28)', () => {
  for (const { name, argKey, extraArgs } of ALL_FUNCTIONS) {
    describe(name, () => {
      it.each(INVALID_INPUTS)(
        `rejects ${argKey}: %s with INVALID_INPUT / non_string_input`,
        async (_label, invalidValue) => {
          const ctx = makeRuntimeCtx();
          const invalidateSpy = vi.spyOn(ctx, 'invalidate');

          const args: Record<string, unknown> = {
            [argKey]: invalidValue,
            ...extraArgs,
          };

          await fn(name)(args, ctx);

          expect(invalidateSpy).toHaveBeenCalled();
          const [, meta] = invalidateSpy.mock.calls[0];
          expect(meta.code).toBe('INVALID_INPUT');
          expect(meta.provider).toBe('text');
          expect(meta.raw).toMatchObject({ kind: 'non_string_input' });
        }
      );
    });
  }
});
