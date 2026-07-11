/**
 * Frontmatter splitter for rill prompt files.
 *
 * Splits a prompt source string on `---` fences into a frontmatter block
 * and a body. Throws RuntimeError RILL-R001 for malformed input.
 */

import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// TYPES
// ============================================================

export interface FrontmatterSplit {
  /** Raw text between the opening and closing `---` fences, excluding fences. */
  frontmatter: string;
  /** Text after the closing `---` fence. */
  body: string;
  /** 1-based line number of the first body line. */
  bodyLineOffset: number;
}

// ============================================================
// SPLIT FRONTMATTER
// ============================================================

/**
 * Splits a prompt source string on `---` fences.
 *
 * Returns `frontmatter` (text between fences, excluding fences),
 * `body` (text after closing fence), and `bodyLineOffset` (1-based
 * line number of the first body line, for error reporting).
 *
 * @throws RuntimeError RILL-R001 when opening fence is missing (EC-1)
 * @throws RuntimeError RILL-R001 when closing fence is missing (EC-2)
 */
export function splitFrontmatter(source: string): FrontmatterSplit {
  const lines = source.split('\n');

  // EC-1: opening fence must be the first line
  if (lines[0] !== '---') {
    throw new RuntimeError(
      'RILL-R001',
      'prompt file must begin with a frontmatter fence (---)'
    );
  }

  // Find the closing fence starting from line index 1
  const closingIndex = lines.indexOf('---', 1);

  // EC-2: no closing fence found
  if (closingIndex === -1) {
    throw new RuntimeError(
      'RILL-R001',
      'frontmatter block is not closed — missing closing fence (---)'
    );
  }

  const frontmatter = lines.slice(1, closingIndex).join('\n');
  const body = lines.slice(closingIndex + 1).join('\n');

  // bodyLineOffset is 1-based: opening fence=1, frontmatter lines, closing fence,
  // then body starts at closingIndex+2 (1-based).
  const bodyLineOffset = closingIndex + 2;

  return { frontmatter, body, bodyLineOffset };
}
