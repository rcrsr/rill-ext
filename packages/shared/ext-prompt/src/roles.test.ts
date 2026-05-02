/**
 * Unit tests for splitRoleMessages and VALID_ROLES.
 *
 * Covers:
 *   IR-5  — happy path: ordered role list with correct content
 *   AC-19 — ## heading inside a role section stays as body text
 *   EC-5  — no @@ role marker → RuntimeError RILL-R001
 *   IR-16 — VALID_ROLES exported constant
 *   IR-15 — role allowlist enforcement in splitRoleMessages
 *   EC-23 — invalid role marker → RuntimeError RILL-R001 with role + line number
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { splitRoleMessages, VALID_ROLES } from './roles.js';

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

  // ============================================================
  // IR-16: VALID_ROLES CONSTANT
  // ============================================================

  describe('VALID_ROLES (IR-16)', () => {
    it('exports VALID_ROLES as a readonly tuple', () => {
      expect(VALID_ROLES).toEqual(['system', 'user', 'assistant']);
    });

    it('contains exactly system, user, and assistant', () => {
      expect(VALID_ROLES).toHaveLength(3);
      expect(VALID_ROLES).toContain('system');
      expect(VALID_ROLES).toContain('user');
      expect(VALID_ROLES).toContain('assistant');
    });
  });

  // ============================================================
  // IR-15 / EC-23: ROLE ALLOWLIST ENFORCEMENT
  // ============================================================

  describe('role allowlist enforcement (IR-15, EC-23)', () => {
    it('accepts @@ system without error', () => {
      const body = '@@ system\nYou are helpful.';
      expect(() => splitRoleMessages(body)).not.toThrow();
    });

    it('accepts @@ user without error', () => {
      const body = '@@ user\nHello!';
      expect(() => splitRoleMessages(body)).not.toThrow();
    });

    it('accepts @@ assistant without error', () => {
      const body = '@@ assistant\nI can help.';
      expect(() => splitRoleMessages(body)).not.toThrow();
    });

    it('rejects @@ tool with RuntimeError RILL-R001', () => {
      const body = '@@ tool\nsome tool output';
      expect(() => splitRoleMessages(body)).toThrow(RuntimeError);
    });

    it('rejects @@ model with RuntimeError RILL-R001', () => {
      const body = '@@ model\nsome model name';
      expect(() => splitRoleMessages(body)).toThrow(RuntimeError);
    });

    it('rejects @@ foo with RuntimeError RILL-R001', () => {
      const body = '@@ foo\nsome content';
      expect(() => splitRoleMessages(body)).toThrow(RuntimeError);
    });

    it('error message contains the offending role name', () => {
      const body = '@@ tool\noutput';
      expect(() => splitRoleMessages(body)).toThrow("'@@ tool'");
    });

    it('error message contains the valid roles list', () => {
      const body = '@@ model\noutput';
      expect(() => splitRoleMessages(body)).toThrow(
        'Valid roles are: system, user, assistant.',
      );
    });

    it('error message contains the correct 1-based line number for a marker on line 1', () => {
      const body = '@@ tool\noutput';
      expect(() => splitRoleMessages(body)).toThrow('at line 1');
    });

    it('error message contains the correct 1-based line number for a marker on line 3', () => {
      const body = 'preamble line 1\npreamble line 2\n@@ foo\noutput';
      expect(() => splitRoleMessages(body)).toThrow('at line 3');
    });

    it('error message contains the correct 1-based line number for a marker on line 5', () => {
      const body = '@@ user\nline 1\nline 2\nline 3\n@@ invalid\noutput';
      expect(() => splitRoleMessages(body)).toThrow('at line 5');
    });
  });
});
