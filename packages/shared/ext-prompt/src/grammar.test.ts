/**
 * Unit tests for parseParamGrammar.
 *
 * Covers:
 * happy path dispatch for all supported types, with and without defaults
 * malformed entry (no `:` separator) → RuntimeError RILL-R001
 * unrecognized type → RuntimeError RILL-R001
 * Rejections of dynamic, union, mixed-arg and non-renderable types are
 * asserted in typeRefToStructure.test.ts (parseParamGrammar delegates there).
 *
 * Both `num` and `callable` are hard-rejected (not valid rill type names).
 * Non-renderable types (closure, iterator, stream, vector, type) are also
 * hard-rejected because they produce placeholder strings, not useful prompt text.
 *
 * Parameterized types (e.g. list(string), dict(a: string, b: number)) are
 * parsed via rill's parseTypeRef and adapted via typeRefToStructure.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { parseParamGrammar } from './grammar.js';

function expectR001(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RuntimeError);
  expect((thrown as RuntimeError).errorId).toBe('RILL-R001');
  expect((thrown as RuntimeError).message).toContain(message);
}

// ============================================================
// HAPPY PATH — NO DEFAULT
// ============================================================

describe('parseParamGrammar', () => {
  describe('happy path — no default', () => {
    it.each([
      { entry: 'question: string', name: 'question', kind: 'string' },
      { entry: 'count: number', name: 'count', kind: 'number' },
      { entry: 'verbose: bool', name: 'verbose', kind: 'bool' },
      { entry: 'options: dict', name: 'options', kind: 'dict' },
      { entry: 'items: list', name: 'items', kind: 'list' },
      { entry: 'value: any', name: 'value', kind: 'any' },
    ])('parses $kind param "$entry" without a default', (row) => {
      const result = parseParamGrammar(row.entry);
      expect(result.name).toBe(row.name);
      expect(result.type).toEqual({ kind: row.kind });
      expect(result.defaultValue).toBeUndefined();
    });
  });

  // ============================================================
  // HAPPY PATH — WITH DEFAULT
  // ============================================================

  describe('happy path — with default', () => {
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
  // WHITESPACE TRIMMING
  // ============================================================

  describe('whitespace trimming', () => {
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
  // PARAMETERIZED TYPES
  // ============================================================

  describe('parseParamGrammar — parameterized types', () => {
    it('parses list(string)', () => {
      const result = parseParamGrammar('items: list(string)');
      expect(result.name).toBe('items');
      expect(result.type).toEqual({
        kind: 'list',
        element: { kind: 'string' },
      });
    });

    it('parses list(number)', () => {
      const result = parseParamGrammar('scores: list(number)');
      expect(result.type).toEqual({
        kind: 'list',
        element: { kind: 'number' },
      });
    });

    it('parses dict(string)', () => {
      const result = parseParamGrammar('lookup: dict(string)');
      expect(result.type).toEqual({
        kind: 'dict',
        valueType: { kind: 'string' },
      });
    });

    it('parses dict(a: string, b: number)', () => {
      const result = parseParamGrammar('point: dict(a: string, b: number)');
      expect(result.type).toEqual({
        kind: 'dict',
        fields: {
          a: { type: { kind: 'string' } },
          b: { type: { kind: 'number' } },
        },
      });
    });

    it('parses list(dict(a: string, b: string))', () => {
      const result = parseParamGrammar(
        'articles: list(dict(a: string, b: string))'
      );
      expect(result.type).toEqual({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            a: { type: { kind: 'string' } },
            b: { type: { kind: 'string' } },
          },
        },
      });
    });

    it('parses list(list(string))', () => {
      const result = parseParamGrammar('matrix: list(list(string))');
      expect(result.type).toEqual({
        kind: 'list',
        element: { kind: 'list', element: { kind: 'string' } },
      });
    });
  });

  // ============================================================
  // REJECTIONS
  // ============================================================

  describe('missing colon separator', () => {
    it.each([
      { entry: 'tone = neutral' },
      { entry: 'justname' },
      { entry: '' },
    ])('throws RILL-R001 malformed entry for "$entry"', (row) => {
      expectR001(() => parseParamGrammar(row.entry), 'malformed param entry');
    });
  });

  describe('unrecognized type', () => {
    it.each([
      { entry: 'x: widget', typeName: 'widget' },
      { entry: 'x: String', typeName: 'String' },
      { entry: 'x: NUMBER', typeName: 'NUMBER' },
      { entry: 'count: num', typeName: 'num' },
      { entry: 'fn: callable', typeName: 'callable' },
    ])('throws RILL-R001 for type "$typeName"', (row) => {
      expectR001(
        () => parseParamGrammar(row.entry),
        `failed to parse param type "${row.typeName}"`
      );
    });

    it('throws RILL-R001 for empty type', () => {
      expectR001(
        () => parseParamGrammar('x: '),
        'failed to parse param type ""'
      );
    });
  });

  describe('unsupported defaults (v0 constraint)', () => {
    it.each([
      { entry: 'opts: dict = {}', kind: 'dict' },
      { entry: 'tags: list = []', kind: 'list' },
      { entry: 'val: any = something', kind: 'any' },
    ])('throws RILL-R001 when $kind has a default', (row) => {
      expectR001(
        () => parseParamGrammar(row.entry),
        `defaults for param type "${row.kind}" are not supported in v0`
      );
    });
  });

  describe('invalid default values', () => {
    it('throws RILL-R001 for non-numeric default on number type', () => {
      expectR001(
        () => parseParamGrammar('count: number = abc'),
        'default value for number param "count" is not a valid number: "abc"'
      );
    });

    it.each([
      { entry: 'flag: bool = True', raw: 'True' },
      { entry: 'flag: bool = yes', raw: 'yes' },
    ])('throws RILL-R001 for bool default "$raw"', (row) => {
      expectR001(
        () => parseParamGrammar(row.entry),
        `default value for bool param "flag" must be "true" or "false", got: "${row.raw}"`
      );
    });
  });
});
