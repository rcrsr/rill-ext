/**
 * Pure helpers for HTML processing: plain-text conversion, Markdown
 * conversion, article extraction, and entity decoding.
 *
 * No validation logic lives here — all input guards are in factory closures.
 *
 * External libraries (TD-3, TD-4):
 *   html-to-text  — strip tags, decode entities, word-wrap
 *   turndown      — HTML → CommonMark Markdown
 *   defuddle/node — article extraction (strips nav, ads, sidebars)
 *   linkedom      — server-side DOM parsing for defuddle
 *   entities      — named and numeric HTML entity decoding
 *
 * @module
 */

import { convert } from 'html-to-text';
import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import { decodeHTML } from 'entities';

// ----------------------------------------------------------
// Module-level singleton: TurndownService (atx headings per AC-4)
// ----------------------------------------------------------

const _turndown = new TurndownService({ headingStyle: 'atx' });

// ----------------------------------------------------------
// htmlToText
// ----------------------------------------------------------

/**
 * Convert HTML to plain text.
 *
 * - Tags are stripped; text content is preserved.
 * - `<script>` and `<style>` blocks are removed (AC-3).
 * - HTML entities (including `&nbsp;`) are decoded to their character
 *   equivalents (AC-2).
 * - `includeLinks = true` appends href values in brackets after anchor text.
 * - `wordWrap = false` disables line-length wrapping.
 * - `wordWrapWidth` sets the column limit when `wordWrap = true`.
 *
 * AC-1: `<p>Hello <b>world</b></p>` → `Hello world`
 * AC-2: `&nbsp;` → space character
 * AC-3: `<script>x</script><p>c</p>` → `c`
 */
export function htmlToText(
  html: string,
  includeLinks: boolean,
  wordWrap: boolean,
  wordWrapWidth: number,
): string {
  return convert(html, {
    wordwrap: wordWrap ? wordWrapWidth : false,
    selectors: [
      // <script> and <style> are skipped (no text extracted).
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      // Anchor text: show or hide href based on includeLinks.
      {
        selector: 'a',
        options: { ignoreHref: !includeLinks },
      },
    ],
  });
}

// ----------------------------------------------------------
// htmlToMarkdown
// ----------------------------------------------------------

/**
 * Convert HTML to CommonMark Markdown.
 *
 * Returns an empty string for empty input (AC-41).
 *
 * AC-4: `<h1>T</h1><p>B</p>` → `# T\n\nB`
 */
export function htmlToMarkdown(html: string): string {
  if (html.length === 0) {
    return '';
  }
  return _turndown.turndown(html);
}

// ----------------------------------------------------------
// extractContent
// ----------------------------------------------------------

/**
 * Extract the main article content from a full HTML page.
 *
 * Uses defuddle (via linkedom) to identify and return the primary content
 * block, stripping navigation, ads, sidebars, and other chrome.
 *
 * Fall-back path (AC-42): when defuddle finds no `<article>` or `<main>`
 * element it wraps the result in `<body>…</body>`.  In that case this helper
 * returns `document.body.innerHTML` so callers receive raw body content
 * without the outer `<body>` wrapper.
 *
 * AC-5: full page with `<article>` → article HTML fragment
 * AC-42: page with no `<article>`/`<main>` → body innerHTML
 */
export async function extractContent(html: string): Promise<string> {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, '');

  const content = result.content;

  // Defuddle wraps the result in <body>…</body> when it cannot locate a
  // dedicated content element.  Fall back to raw body innerHTML in that case.
  if (content.trimStart().startsWith('<body')) {
    return document.body?.innerHTML ?? content;
  }

  return content;
}

// ----------------------------------------------------------
// decodeEntities
// ----------------------------------------------------------

/**
 * Decode HTML entities in `text`.
 *
 * - Named entities: `&amp;` → `&` (AC-6)
 * - Numeric entities: `&#65;&#66;&#67;` → `ABC` (AC-7)
 * - Unknown entity sequences are returned verbatim (AC-36)
 * - Input without entities is returned unchanged (AC-36)
 */
export function decodeEntities(text: string): string {
  return decodeHTML(text);
}
