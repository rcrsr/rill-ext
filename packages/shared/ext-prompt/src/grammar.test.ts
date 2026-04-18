/**
 * Unit tests for parseParamGrammar.
 *
 * Covers:
 *   IR-3  — happy path dispatch for all supported types, with and without defaults
 *   EC-3  — malformed entry (no `:` separator) → RuntimeError RILL-R001
 *   EC-4  — unrecognized type → RuntimeError RILL-R001
 *
 * Canonical type names used: number (not num), closure (not callable).
 * Both `num` and `callable` are hard-rejected as unrecognized types.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { parseParamGrammar } from './grammar.js';

// ============================================================
// HAPPY PATH (IR-3) — NO DEFAULT
// ============================================================

describe('parseParamGrammar', () => {
  describe('happy path — no default (IR-3)', () => {
    it('parses string param', () => {
      const result = parseParamGrammar('question: string');
      expect(result.name).toBe('question');
      expect(result.type).toEqual({ kind: 'string' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses number param', () => {
      const result = parseParamGrammar('count: number');
      expect(result.name).toBe('count');
      expect(result.type).toEqual({ kind: 'number' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses bool param', () => {
      const result = parseParamGrammar('verbose: bool');
      expect(result.name).toBe('verbose');
      expect(result.type).toEqual({ kind: 'bool' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses dict param', () => {
      const result = parseParamGrammar('options: dict');
      expect(result.name).toBe('options');
      expect(result.type).toEqual({ kind: 'dict' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses list param', () => {
      const result = parseParamGrammar('items: list');
      expect(result.name).toBe('items');
      expect(result.type).toEqual({ kind: 'list' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses any param', () => {
      const result = parseParamGrammar('value: any');
      expect(result.name).toBe('value');
      expect(result.type).toEqual({ kind: 'any' });
      expect(result.defaultValue).toBeUndefined();
    });

    it('parses closure param', () => {
      const result = parseParamGrammar('handler: closure');
      expect(result.name).toBe('handler');
      expect(result.type).toEqual({ kind: 'closure' });
      expect(result.defaultValue).toBeUndefined();
    });
  });

  // ============================================================
  // HAPPY PATH — WITH DEFAULT (IR-3)
  // ============================================================

  describe('happy path — with default (IR-3)', () => {
    it('parses number with integer default', () => {
      const result = parseParamGrammar('count: number = 3');
      expect(result.name).toBe('count');
      expect(result.defaultValue).toBe(3);
    });

    it('parses number with float default', () => {
      const result = parseParamGrammar('ratio: number = 1.5');
      expect(result.defaultValue).toBe(1.5);
    });

    it('parses number with negative default', () => {
      const result = parseParamGrammar('offset: number = -2');
      expect(result.defaultValue).toBe(-2);
    });

    it('parses bool with true default', () => {
      const result = parseParamGrammar('flag: bool = true');
      expect(result.name).toBe('flag');
      expect(result.defaultValue).toBe(true);
    });

    it('parses bool with false default', () => {
      const result = parseParamGrammar('debug: bool = false');
      expect(result.defaultValue).toBe(false);
    });

    it('parses string with word default', () => {
      const result = parseParamGrammar('tone: string = neutral');
      expect(result.name).toBe('tone');
      expect(result.defaultValue).toBe('neutral');
    });

    it('parses string with multi-word default', () => {
      const result = parseParamGrammar('label: string = hello world');
      expect(result.defaultValue).toBe('hello world');
    });
  });

  // ============================================================
  // WHITESPACE TRIMMING (IR-3)
  // ============================================================

  describe('whitespace trimming (IR-3)', () => {
    it('trims whitespace around name', () => {
      const result = parseParamGrammar('  question  : string');
      expect(result.name).toBe('question');
    });

    it('trims whitespace around type', () => {
      const result = parseParamGrammar('question:   string  ');
      expect(result.type).toEqual({ kind: 'string' });
    });

    it('trims whitespace around default', () => {
      const result = parseParamGrammar('count: number =   7  ');
      expect(result.defaultValue).toBe(7);
    });

    it('trims whitespace around string default', () => {
      const result = parseParamGrammar('tone: string =   neutral  ');
      expect(result.defaultValue).toBe('neutral');
    });
  });

  // ============================================================
  // EC-3: MISSING COLON SEPARATOR
  // ============================================================

  describe('missing colon separator (EC-3)', () => {
    it('throws RuntimeError for entry without colon', () => {
      expect(() => parseParamGrammar('tone = neutral')).toThrow(RuntimeError);
    });

    it('throws with error code RILL-R001', () => {
      try {
        parseParamGrammar('tone = neutral');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });

    it('throws for plain name with no separator', () => {
      expect(() => parseParamGrammar('justname')).toThrow(RuntimeError);
    });

    it('throws for empty entry', () => {
      expect(() => parseParamGrammar('')).toThrow(RuntimeError);
    });
  });

  // ============================================================
  // EC-4: UNRECOGNIZED TYPE
  // ============================================================

  describe('unrecognized type (EC-4)', () => {
    it('throws RuntimeError for unknown type', () => {
      expect(() => parseParamGrammar('x: widget')).toThrow(RuntimeError);
    });

    it('throws with error code RILL-R001', () => {
      try {
        parseParamGrammar('x: widget');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });

    it('throws for type with wrong casing (e.g. String)', () => {
      expect(() => parseParamGrammar('x: String')).toThrow(RuntimeError);
    });

    it('throws for type with wrong casing (e.g. NUMBER)', () => {
      expect(() => parseParamGrammar('x: NUMBER')).toThrow(RuntimeError);
    });

    it('throws for empty type', () => {
      expect(() => parseParamGrammar('x: ')).toThrow(RuntimeError);
    });

    // Hard reject legacy aliases — no backward compat
    it('rejects num (use number)', () => {
      try {
        parseParamGrammar('count: num');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });

    it('rejects callable (use closure)', () => {
      try {
        parseParamGrammar('fn: callable');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });
  });

  // ============================================================
  // UNSUPPORTED DEFAULTS (v0 constraint)
  // ============================================================

  describe('unsupported defaults (v0 constraint)', () => {
    it('throws RuntimeError when dict has a default', () => {
      expect(() => parseParamGrammar('opts: dict = {}')).toThrow(RuntimeError);
    });

    it('throws RuntimeError when list has a default', () => {
      expect(() => parseParamGrammar('tags: list = []')).toThrow(RuntimeError);
    });

    it('throws RuntimeError when closure has a default', () => {
      expect(() => parseParamGrammar('fn: closure = something')).toThrow(RuntimeError);
    });

    it('throws RuntimeError when any has a default', () => {
      expect(() => parseParamGrammar('val: any = something')).toThrow(RuntimeError);
    });
  });

  // ============================================================
  // INVALID DEFAULT VALUES
  // ============================================================

  describe('invalid default values', () => {
    it('throws RuntimeError for non-numeric default on number type', () => {
      expect(() => parseParamGrammar('count: number = abc')).toThrow(RuntimeError);
    });

    it('throws RuntimeError for mixed-case bool default', () => {
      expect(() => parseParamGrammar('flag: bool = True')).toThrow(RuntimeError);
    });

    it('throws RuntimeError for bool default that is not true or false', () => {
      expect(() => parseParamGrammar('flag: bool = yes')).toThrow(RuntimeError);
    });
  });
});
