/**
 * Pure helpers for text segmentation: paragraph splitting, sliding window,
 * and truncation.
 *
 * No external dependencies — uses built-in string and array operations only.
 *
 * @module
 */

/**
 * Split `text` into paragraphs separated by blank lines.
 *
 * A blank line is a line containing only optional whitespace.  One or more
 * consecutive blank lines count as a single separator. Trailing
 * blank entries produced by a trailing blank line are removed.
 *
 * Returns `[]` for empty or all-blank input.
 *
 * Examples:
 * splitParagraphs('a\n\nb') → ['a', 'b']
 * splitParagraphs('a\n\n') → ['a']
 * splitParagraphs('a\n\n\n\nb') → ['a', 'b']
 */
export function splitParagraphs(text: string): string[] {
  if (text.trim().length === 0) {
    return [];
  }
  // Split on one or more blank lines (lines with only optional whitespace).
  // The `+` quantifier collapses consecutive blank lines into one separator.
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Slide a fixed-size window across `text`, producing overlapping or
 * non-overlapping slices.
 *
 * - Empty string returns `[]`.
 * - When `text.length <= size`, returns a single-element array with the
 * full text.
 * - Otherwise iterates `i` from `0` in increments of `step`, producing
 *   `text.slice(i, i + size)`.  The final window is included even when
 * it is shorter than `size`.
 *
 * The internal function name is `windowFn` to avoid colliding with the
 * browser/DOM global `window`. The factory maps it to the
 * host-function key `'window'`.
 *
 * Examples:
 * windowFn('a'.repeat(100), 30, 30) → 4 windows: [0:30, 30:60, 60:90, 90:100]
 * windowFn('a'.repeat(100), 30, 20) → 5 windows starting at 0,20,40,60,80
 * windowFn('', 5, 5) → []
 * windowFn('hi', 30, 30) → ['hi']
 */
export function windowFn(text: string, size: number, step: number): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= size) {
    return [text];
  }
  const result: string[] = [];
  let i = 0;
  while (i < text.length) {
    result.push(text.slice(i, i + size));
    i += step;
  }
  return result;
}

/**
 * Truncate `text` to at most `max` characters, optionally at a word
 * boundary, and append `ellipsis`.
 *
 * - Returns `text` unchanged when `text.length <= max`.
 * - When `wordBoundary` is `false`: hard-cut at `max`.
 * - When `wordBoundary` is `true`: find the last whitespace at or before
 *   `max`; truncate there.  Falls back to hard-cut at `max` when no
 * whitespace exists in the prefix.
 * - `ellipsis` is appended after the cut; pass `""` for no ellipsis.
 *
 * Examples:
 * truncate('x'.repeat(500), 100, false, '') → 100-char string
 * truncate('hello world goodbye', 12, true, '') → 'hello world'
 * truncate('hi', 100, false, '') → 'hi'
 */
export function truncate(
  text: string,
  max: number,
  wordBoundary: boolean,
  ellipsis: string
): string {
  if (text.length <= max) {
    return text;
  }

  let cutIndex = max;

  if (wordBoundary) {
    const prefix = text.slice(0, max);
    // Search for the last whitespace character in the prefix.
    const lastSpace = prefix.search(/\s(?=\S*$)/);
    if (lastSpace !== -1) {
      cutIndex = lastSpace;
    }
    // If no whitespace found, fall back to hard cut at max (cutIndex stays max).
  }

  return text.slice(0, cutIndex) + ellipsis;
}
