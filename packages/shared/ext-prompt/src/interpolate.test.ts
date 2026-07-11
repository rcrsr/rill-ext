/**
 * Unit tests for interpolate and scanTemplateReferences.
 *
 * Covers:
 *   IR-4  — {name} substitution, multi-reference, multi-line bodies
 *   AC-15 — {{ → {, }} → }, {{name}} → {name} (no substitution)
 *   IR-7  — scanTemplateReferences returns 1-based line positions
 *   IR-7  — {{name}} is NOT reported as a reference
 */

import { describe, it, expect } from 'vitest';
import { interpolate, scanTemplateReferences } from './interpolate.js';

// ============================================================
// interpolate — IR-4
// ============================================================

describe('interpolate', () => {
  describe('basic substitution (IR-4)', () => {
    it('substitutes a single reference', () => {
      expect(interpolate('Hello {name}', { name: 'world' })).toBe(
        'Hello world'
      );
    });

    it('substitutes multiple references in one line', () => {
      expect(
        interpolate('{greeting}, {name}!', { greeting: 'Hi', name: 'Alice' })
      ).toBe('Hi, Alice!');
    });

    it('substitutes the same reference appearing twice', () => {
      expect(interpolate('{x} and {x}', { x: 'foo' })).toBe('foo and foo');
    });

    it('handles empty body', () => {
      expect(interpolate('', {})).toBe('');
    });

    it('handles body with no references', () => {
      expect(interpolate('no refs here', {})).toBe('no refs here');
    });

    it('handles multi-line body with references on different lines', () => {
      const body = 'Line1: {a}\nLine2: {b}';
      expect(interpolate(body, { a: 'alpha', b: 'beta' })).toBe(
        'Line1: alpha\nLine2: beta'
      );
    });

    it('uses empty string for missing key (never throws)', () => {
      expect(interpolate('{missing}', {})).toBe('');
    });

    it('does not throw when values map is empty but body has references', () => {
      expect(() => interpolate('{x}', {})).not.toThrow();
    });
  });

  // ============================================================
  // interpolate — AC-15 escape sequences
  // ============================================================

  describe('escape sequences (AC-15)', () => {
    it('{{ emits literal {', () => {
      expect(interpolate('{{', {})).toBe('{');
    });

    it('}} emits literal }', () => {
      expect(interpolate('}}', {})).toBe('}');
    });

    it('{{name}} emits literal {name} without substitution', () => {
      expect(interpolate('{{name}}', { name: 'world' })).toBe('{name}');
    });

    it('{{name}} does not substitute even when key exists', () => {
      const result = interpolate('Value: {{x}}', { x: 'injected' });
      expect(result).toBe('Value: {x}');
    });

    it('mixes escaped and unescaped in same string', () => {
      // {{ → {, {b} → bar, }} → }
      expect(interpolate('{{literal}} and {b}', { b: 'bar' })).toBe(
        '{literal} and bar'
      );
    });

    it('handles }} at end of string', () => {
      expect(interpolate('end}}', {})).toBe('end}');
    });

    it('handles {{ at start of string', () => {
      expect(interpolate('{{start', {})).toBe('{start');
    });
  });
});

// ============================================================
// scanTemplateReferences — IR-7
// ============================================================

describe('scanTemplateReferences', () => {
  describe('basic scanning (IR-7)', () => {
    it('returns empty array for body with no references', () => {
      expect(scanTemplateReferences('no braces here')).toEqual([]);
    });

    it('returns single reference with line 1', () => {
      expect(scanTemplateReferences('{name}')).toEqual([
        { name: 'name', line: 1 },
      ]);
    });

    it('returns two references on the same line', () => {
      const refs = scanTemplateReferences('{a} and {b}');
      expect(refs).toEqual([
        { name: 'a', line: 1 },
        { name: 'b', line: 1 },
      ]);
    });

    it('returns references on separate lines with correct 1-based line numbers', () => {
      const refs = scanTemplateReferences('L1 {a}\n{b}');
      expect(refs).toEqual([
        { name: 'a', line: 1 },
        { name: 'b', line: 2 },
      ]);
    });

    it('correctly tracks line numbers across multiple newlines', () => {
      const body = 'line1\nline2 {x}\nline3\nline4 {y}';
      const refs = scanTemplateReferences(body);
      expect(refs).toEqual([
        { name: 'x', line: 2 },
        { name: 'y', line: 4 },
      ]);
    });

    it('returns empty array for empty body', () => {
      expect(scanTemplateReferences('')).toEqual([]);
    });
  });

  describe('escaped forms not reported (IR-7)', () => {
    it('does NOT report {{name}} (escaped)', () => {
      expect(scanTemplateReferences('{{name}}')).toEqual([]);
    });

    it('does NOT report standalone {{ escape', () => {
      expect(scanTemplateReferences('{{')).toEqual([]);
    });

    it('does NOT report standalone }} escape', () => {
      expect(scanTemplateReferences('}}')).toEqual([]);
    });

    it('reports unescaped ref but not escaped ref in same body', () => {
      const refs = scanTemplateReferences('{{escaped}} and {real}');
      expect(refs).toEqual([{ name: 'real', line: 1 }]);
    });
  });
});
