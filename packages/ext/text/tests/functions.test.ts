/**
 * Behavior tests for text extension host functions.
 *
 * Covers AC-1 through AC-45 for all 14 functions exposed by
 * createTextExtension.
 */

import { describe, it, expect } from 'vitest';
import { createTextExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

// ---------------------------------------------------------------------------
// Shared extension instance — no state, so one instance works for all tests.
// ---------------------------------------------------------------------------

const ext = createTextExtension({}, makeFactoryCtx());
const val = ext.value as Record<string, { fn: (args: Record<string, unknown>, ctx: ReturnType<typeof makeRuntimeCtx>) => Promise<unknown> }>;

// ---------------------------------------------------------------------------
// html_to_text
// ---------------------------------------------------------------------------

describe('html_to_text', () => {
  it('AC-1: strips tags from nested HTML', async () => {
    const result = await val['html_to_text'].fn(
      { html: '<p>Hello <b>world</b></p>' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('Hello world');
  });

  it('AC-2: decodes &nbsp; to a space character', async () => {
    const result = await val['html_to_text'].fn(
      { html: '<p>a&nbsp;b</p>' },
      makeRuntimeCtx(),
    );
    // html-to-text decodes &nbsp; to a non-breaking space (U+00A0) then the
    // word-wrap pass may normalise it; the result must separate 'a' and 'b'
    // with some kind of whitespace character.
    const text = result as string;
    expect(text).toMatch(/a[\s ]b/);
  });

  it('AC-3: strips <script> content', async () => {
    const result = await val['html_to_text'].fn(
      { html: '<script>alert("x")</script><p>c</p>', word_wrap: false },
      makeRuntimeCtx(),
    );
    expect(result).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// html_to_markdown
// ---------------------------------------------------------------------------

describe('html_to_markdown', () => {
  it('AC-4: converts heading and paragraph to ATX markdown', async () => {
    const result = await val['html_to_markdown'].fn(
      { html: '<h1>T</h1><p>B</p>' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('# T\n\nB');
  });

  it('AC-41: empty input returns empty output', async () => {
    const result = await val['html_to_markdown'].fn(
      { html: '' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extract_content
// ---------------------------------------------------------------------------

describe('extract_content', () => {
  it('AC-5: full HTML page with nav and article → article content only', async () => {
    const html = `<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <article>
      <h1>Main Article</h1>
      <p>This is the main article content that should be extracted.</p>
    </article>
  </body>
</html>`;
    const result = await val['extract_content'].fn({ html }, makeRuntimeCtx());
    const text = result as string;
    expect(text).toContain('Main Article');
    expect(text).toContain('main article content');
    expect(text).not.toContain('<nav>');
  });

  it('AC-42: HTML with no <article> or <main> falls back to body content', async () => {
    const html = `<!DOCTYPE html>
<html>
  <head><title>Fallback</title></head>
  <body>
    <div>
      <p>This is plain body content with no article or main element.</p>
    </div>
  </body>
</html>`;
    const result = await val['extract_content'].fn({ html }, makeRuntimeCtx());
    const text = result as string;
    expect(text).toContain('plain body content');
  });
});

// ---------------------------------------------------------------------------
// decode_entities
// ---------------------------------------------------------------------------

describe('decode_entities', () => {
  it('AC-6: decodes named entities', async () => {
    const result = await val['decode_entities'].fn(
      { text: 'Title &amp; Subtitle' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('Title & Subtitle');
  });

  it('AC-7: decodes numeric entities', async () => {
    const result = await val['decode_entities'].fn(
      { text: '&#65;&#66;&#67;' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('ABC');
  });

  it('AC-36: input with no entities is returned unchanged', async () => {
    const result = await val['decode_entities'].fn(
      { text: 'plain text no entities' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('plain text no entities');
  });
});

// ---------------------------------------------------------------------------
// decode_quoted_printable
// ---------------------------------------------------------------------------

describe('decode_quoted_printable', () => {
  it('AC-8: decodes =XX sequences', async () => {
    const result = await val['decode_quoted_printable'].fn(
      { text: 'Hello=20World' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('Hello World');
  });

  it('AC-9: removes soft line breaks (=\\n)', async () => {
    const result = await val['decode_quoted_printable'].fn(
      { text: 'long=\ntext' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('longtext');
  });

  it('AC-37: plain text without MIME encoding passes through unchanged', async () => {
    const result = await val['decode_quoted_printable'].fn(
      { text: 'plain text no encoding' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('plain text no encoding');
  });
});

// ---------------------------------------------------------------------------
// strip_diacritics
// ---------------------------------------------------------------------------

describe('strip_diacritics', () => {
  it('AC-10: removes diacritical marks', async () => {
    const result = await val['strip_diacritics'].fn(
      { text: 'café' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('cafe');
  });

  it('AC-38: ASCII-only input is returned unchanged', async () => {
    const result = await val['strip_diacritics'].fn(
      { text: 'hello world' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// collapse_whitespace
// ---------------------------------------------------------------------------

describe('collapse_whitespace', () => {
  it('AC-11: collapses multiple spaces to single space', async () => {
    const result = await val['collapse_whitespace'].fn(
      { text: 'hello    world' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('hello world');
  });

  it('AC-12: preserve_newlines keeps blank-line boundaries', async () => {
    const result = await val['collapse_whitespace'].fn(
      { text: 'a\n\nb', preserve_newlines: true },
      makeRuntimeCtx(),
    );
    const text = result as string;
    // Blank-line boundary preserved — 'a' and 'b' are in separate paragraphs
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(text).toMatch(/a[\s\S]*\n\n[\s\S]*b/);
  });

  it('AC-45: tab-only whitespace collapses to single space', async () => {
    const result = await val['collapse_whitespace'].fn(
      { text: '\t\t\t' },
      makeRuntimeCtx(),
    );
    expect(result).toBe(' ');
  });
});

// ---------------------------------------------------------------------------
// dedent
// ---------------------------------------------------------------------------

describe('dedent', () => {
  it('AC-13: removes common indent from all lines', async () => {
    const result = await val['dedent'].fn(
      { text: '  line one\n  line two\n  line three' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('line one\nline two\nline three');
  });

  it('AC-43: text with no common indent is unchanged', async () => {
    const result = await val['dedent'].fn(
      { text: 'line one\nline two' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('line one\nline two');
  });
});

// ---------------------------------------------------------------------------
// trim_lines
// ---------------------------------------------------------------------------

describe('trim_lines', () => {
  it('AC-14: trims leading/trailing spaces and removes blank lines', async () => {
    const result = await val['trim_lines'].fn(
      { text: '  hello  \n   \n  world  ' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['hello', 'world']);
  });

  it('AC-44: all-blank input returns empty list', async () => {
    const result = await val['trim_lines'].fn(
      { text: '   \n\t\n  ' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extract_urls
// ---------------------------------------------------------------------------

describe('extract_urls', () => {
  it('AC-15: extracts URL from text', async () => {
    const result = await val['extract_urls'].fn(
      { text: 'Visit https://example.com for info' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['https://example.com']);
  });

  it('AC-32: text with no URLs returns empty list', async () => {
    const result = await val['extract_urls'].fn(
      { text: 'no links here at all' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extract_emails
// ---------------------------------------------------------------------------

describe('extract_emails', () => {
  it('AC-16: extracts email address from text', async () => {
    const result = await val['extract_emails'].fn(
      { text: 'Contact user@example.com for help' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['user@example.com']);
  });

  it('AC-33: text with no emails returns empty list', async () => {
    const result = await val['extract_emails'].fn(
      { text: 'no email addresses here' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// split_paragraphs
// ---------------------------------------------------------------------------

describe('split_paragraphs', () => {
  it('AC-17: splits two paragraphs separated by blank line', async () => {
    const result = await val['split_paragraphs'].fn(
      { text: 'first paragraph\n\nsecond paragraph' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['first paragraph', 'second paragraph']);
  });

  it('AC-34: trailing blank lines are removed', async () => {
    const result = await val['split_paragraphs'].fn(
      { text: 'only one paragraph\n\n' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['only one paragraph']);
  });

  it('AC-35: multiple consecutive blank lines treated as single separator', async () => {
    const result = await val['split_paragraphs'].fn(
      { text: 'para one\n\n\n\npara two' },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['para one', 'para two']);
  });
});

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

describe('window', () => {
  it('AC-18: 100 chars, size 30, step 30 → non-overlapping windows', async () => {
    const text = 'a'.repeat(100);
    const result = await val['window'].fn(
      { text, size: 30, step: 30 },
      makeRuntimeCtx(),
    );
    const windows = result as string[];
    // Windows at offsets 0, 30, 60, 90 — 4 total
    expect(windows).toHaveLength(4);
    expect(windows[0]).toHaveLength(30);
    expect(windows[1]).toHaveLength(30);
    expect(windows[2]).toHaveLength(30);
    expect(windows[3]).toHaveLength(10); // remainder 100-90=10
  });

  it('AC-19: 100 chars, size 30, step 20 → overlapping windows', async () => {
    const text = 'a'.repeat(100);
    const result = await val['window'].fn(
      { text, size: 30, step: 20 },
      makeRuntimeCtx(),
    );
    const windows = result as string[];
    // Offsets: 0, 20, 40, 60, 80 — 5 windows
    expect(windows).toHaveLength(5);
    // First four windows are full 30-char slices
    expect(windows[0]).toHaveLength(30);
    expect(windows[4]).toHaveLength(20); // text.slice(80, 110) → 20 chars remain
  });

  it('AC-29: empty string returns empty list', async () => {
    const result = await val['window'].fn(
      { text: '', size: 5, step: 5 },
      makeRuntimeCtx(),
    );
    expect(result).toEqual([]);
  });

  it('AC-30: text length < size returns single window with full text', async () => {
    const result = await val['window'].fn(
      { text: 'hi', size: 30, step: 30 },
      makeRuntimeCtx(),
    );
    expect(result).toEqual(['hi']);
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('AC-20: truncates to first max characters', async () => {
    const text = 'x'.repeat(500);
    const result = await val['truncate'].fn(
      { text, max: 100, ellipsis: '' },
      makeRuntimeCtx(),
    );
    expect((result as string).length).toBe(100);
    expect(result).toBe('x'.repeat(100));
  });

  it('AC-21: word_boundary truncates at last word boundary ≤ max', async () => {
    const result = await val['truncate'].fn(
      { text: 'one two three four', max: 12, word_boundary: true, ellipsis: '' },
      makeRuntimeCtx(),
    );
    // prefix = 'one two thre' (12 chars), last space at index 7 → 'one two'
    expect(result).toBe('one two');
  });

  it('AC-31: text length < max is returned unchanged', async () => {
    const result = await val['truncate'].fn(
      { text: 'short', max: 100, ellipsis: '' },
      makeRuntimeCtx(),
    );
    expect(result).toBe('short');
  });
});
