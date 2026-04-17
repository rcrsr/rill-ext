/**
 * Unit tests for splitRoleMessages.
 *
 * Covers:
 *   IR-5  — happy path: ordered role list with correct content
 *   AC-19 — ## heading inside a role section stays as body text
 *   EC-5  — no @@ role marker → RuntimeError RILL-R001
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { splitRoleMessages } from './roles.js';

// ============================================================
// HAPPY PATH (IR-5)
// ============================================================

describe('splitRoleMessages', () => {
  describe('happy path (IR-5)', () => {
    it('splits a body with @@ system and @@ user into ordered role entries', () => {
      const body = '@@ system\nYou are a helpful assistant.\n@@ user\nHello!';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
      expect(result[1]).toEqual({ role: 'user', content: 'Hello!' });
    });

    it('returns roles in the order they appear in the body', () => {
      const body = '@@ user\nfirst\n@@ assistant\nsecond\n@@ user\nthird';
      const result = splitRoleMessages(body);

      expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    });

    it('handles multi-line content within a role', () => {
      const body = '@@ user\nline 1\nline 2\nline 3';
      const result = splitRoleMessages(body);

      expect(result[0]?.content).toBe('line 1\nline 2\nline 3');
    });

    it('handles a single role with no subsequent markers', () => {
      const body = '@@ system\nOnly one role.';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'Only one role.' });
    });

    it('handles empty content for a role', () => {
      const body = '@@ system\n@@ user\nHello!';
      const result = splitRoleMessages(body);

      expect(result[0]).toEqual({ role: 'system', content: '' });
      expect(result[1]).toEqual({ role: 'user', content: 'Hello!' });
    });
  });

  // ============================================================
  // AC-19: ## HEADING INSIDE ROLE CONTENT
  // ============================================================

  describe('## heading inside role body (AC-19)', () => {
    it('keeps ## heading as body text within the enclosing role', () => {
      const body = '@@ user\n## Instructions\nDo something.';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('user');
      expect(result[0]?.content).toBe('## Instructions\nDo something.');
    });

    it('does not create an extra role entry for a ## heading', () => {
      const body = '@@ system\nSetup.\n## Note\nThis is context.\n@@ user\nHello!';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(2);
      expect(result[0]?.content).toBe('Setup.\n## Note\nThis is context.');
    });

    it('multiple ## headings inside a role remain part of that role', () => {
      const body = '@@ user\n## H1\ntext1\n## H2\ntext2';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(1);
      expect(result[0]?.content).toBe('## H1\ntext1\n## H2\ntext2');
    });
  });

  // ============================================================
  // PRE-MARKER CONTENT → default role 'user'
  // ============================================================

  describe('pre-marker content', () => {
    it('emits a leading user entry when text precedes the first @@ marker', () => {
      const body = 'preamble line 1\npreamble line 2\n@@ assistant\nreply';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'preamble line 1\npreamble line 2' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'reply' });
    });

    it('ignores blank-only preamble', () => {
      const body = '\n\n@@ system\nprompt';
      const result = splitRoleMessages(body);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'prompt' });
    });
  });

  // ============================================================
  // EC-5: NO ROLE MARKERS
  // ============================================================

  describe('no @@ role markers (EC-5)', () => {
    it('throws RuntimeError RILL-R001 when body has no role markers', () => {
      const body = 'no markers here\njust plain text';

      expect(() => splitRoleMessages(body)).toThrow(RuntimeError);
    });

    it('includes a descriptive message about the missing role marker', () => {
      const body = 'no @@ markers at all';

      expect(() => splitRoleMessages(body)).toThrow('role marker');
    });

    it('throws for empty body string', () => {
      expect(() => splitRoleMessages('')).toThrow(RuntimeError);
    });

    it('does not treat ## headings as role markers', () => {
      const body = '## Section\nsome text';

      expect(() => splitRoleMessages(body)).toThrow(RuntimeError);
    });
  });
});
