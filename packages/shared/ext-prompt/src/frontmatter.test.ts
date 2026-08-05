/**
 * Unit tests for splitFrontmatter.
 *
 * Covers:
 * happy path: correct split, bodyLineOffset
 * missing opening fence
 * unclosed frontmatter block
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { splitFrontmatter } from './frontmatter.js';

// ============================================================
// HAPPY PATH
// ============================================================

describe('splitFrontmatter', () => {
  describe('happy path', () => {
    it('splits frontmatter and body from a well-formed source', () => {
      const source =
        '---\ndescription: test prompt\n---\nbody line 1\nbody line 2';
      const result = splitFrontmatter(source);

      expect(result.frontmatter).toBe('description: test prompt');
      expect(result.body).toBe('body line 1\nbody line 2');
    });

    it('returns bodyLineOffset as 1-based line number of first body line', () => {
      // Line 1: ---
      // Line 2: description: test prompt
      // Line 3: ---
      // Line 4: body starts here → bodyLineOffset = 4
      const source = '---\ndescription: test prompt\n---\nbody line 1';
      const result = splitFrontmatter(source);

      expect(result.bodyLineOffset).toBe(4);
    });

    it('frontmatter excludes the opening and closing fence lines', () => {
      const source = '---\nkey: value\nanother: thing\n---\nbody';
      const result = splitFrontmatter(source);

      expect(result.frontmatter).toBe('key: value\nanother: thing');
    });

    it('handles empty frontmatter block', () => {
      const source = '---\n---\nbody';
      const result = splitFrontmatter(source);

      expect(result.frontmatter).toBe('');
      expect(result.body).toBe('body');
      expect(result.bodyLineOffset).toBe(3);
    });

    it('handles empty body after closing fence', () => {
      const source = '---\ndescription: x\n---\n';
      const result = splitFrontmatter(source);

      expect(result.body).toBe('');
    });

    it('body starts immediately after closing fence with no trailing newline', () => {
      const source = '---\nk: v\n---';
      const result = splitFrontmatter(source);

      expect(result.body).toBe('');
      expect(result.bodyLineOffset).toBe(4);
    });
  });

  // ============================================================
  // MISSING OPENING FENCE
  // ============================================================

  describe('missing opening fence', () => {
    it('throws RuntimeError RILL-R001 when source does not start with ---', () => {
      const source = 'description: test prompt\n---\nbody';

      expect(() => splitFrontmatter(source)).toThrow(RuntimeError);
    });

    it('includes a descriptive message about the missing fence', () => {
      const source = 'no fence here';

      expect(() => splitFrontmatter(source)).toThrow('frontmatter fence');
    });

    it('throws for empty source string', () => {
      expect(() => splitFrontmatter('')).toThrow(RuntimeError);
    });
  });

  // ============================================================
  // UNCLOSED FRONTMATTER BLOCK
  // ============================================================

  describe('unclosed frontmatter block', () => {
    it('throws RuntimeError RILL-R001 when closing fence is absent', () => {
      const source = '---\ndescription: test prompt\nbody line 1';

      expect(() => splitFrontmatter(source)).toThrow(RuntimeError);
    });

    it('includes a descriptive message about the missing closing fence', () => {
      const source = '---\nno closing fence';

      expect(() => splitFrontmatter(source)).toThrow('closing fence');
    });
  });
});
