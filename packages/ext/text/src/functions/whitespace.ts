/**
 * Pure helpers for whitespace normalisation.
 *
 * No external dependencies — uses built-in string and array operations only (TD-6).
 *
 * @module
 */

/**
 * Collapse runs of whitespace characters to a single space.
 *
 * When `preserveNewlines` is `false` (default):
 *   All whitespace runs (spaces, tabs, newlines) are collapsed to a single
 *   space.  The result is a single-line string (AC-11, AC-45).
 *
 * When `preserveNewlines` is `true`:
 *   Paragraph boundaries (one or more blank lines) are preserved.  Within
 *   each paragraph, internal whitespace runs are collapsed to a single space.
 *   This retains the gross structure of the document while removing repeated
 *   spaces and tabs (AC-12).
 *
 * Examples:
 *   collapseWhitespace('hello    world', false)  → 'hello world'
 *   collapseWhitespace('\t\t\t', false)           → ' '
 *   collapseWhitespace('para1\n\npara2', true)    → 'para1\n\npara2'
 */
export function collapseWhitespace(text: string, preserveNewlines: boolean): string {
  if (!preserveNewlines) {
    // Collapse every whitespace run (including newlines and tabs) to one space.
    return text.replace(/\s+/g, ' ');
  }

  // Split on sequences of two or more newlines (blank-line boundaries).
  // Each chunk is a paragraph; within it collapse all whitespace runs
  // (including single newlines) to a single space, so only the blank-line
  // boundary creates a paragraph split in the output.
  const paragraphs = text.split(/\n{2,}/);
  const normalised = paragraphs.map((para) => para.replace(/\s+/g, ' ').trim());
  return normalised.join('\n\n');
}

/**
 * Remove the longest common leading-whitespace prefix from every non-empty
 * line in `text`.
 *
 * The common prefix is computed only from lines that contain at least one
 * non-whitespace character; empty or whitespace-only lines are ignored during
 * prefix computation but are kept in the output (AC-13, AC-43).
 *
 * When no common indent exists the text is returned unchanged.
 *
 * Examples:
 *   dedent('  a\n  b')    → 'a\nb'
 *   dedent('a\nb')        → 'a\nb'  (unchanged)
 */
export function dedent(text: string): string {
  const lines = text.split('\n');

  // Collect the leading-whitespace prefix of each non-empty line.
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^(\s*)/.exec(line);
      return match?.[1] ?? '';
    });

  if (indents.length === 0) {
    return text;
  }

  // Find the longest shared prefix across all indents.
  const commonPrefix = indents.reduce((prefix, indent) => {
    let i = 0;
    while (i < prefix.length && i < indent.length && prefix[i] === indent[i]) {
      i++;
    }
    return prefix.slice(0, i);
  });

  if (commonPrefix.length === 0) {
    return text;
  }

  return lines
    .map((line) => (line.startsWith(commonPrefix) ? line.slice(commonPrefix.length) : line))
    .join('\n');
}

/**
 * Split `text` on newlines, trim each line, and return only the non-empty
 * lines.
 *
 * Lines that are empty or contain only whitespace after trimming are dropped.
 * Returns `[]` for all-blank input (AC-14, AC-44).
 *
 * Examples:
 *   trimLines('  a  \n  \n  b  ')  → ['a', 'b']
 *   trimLines('   \n\t\n  ')       → []
 */
export function trimLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
