/**
 * Unit tests for the `p` param builder helpers.
 *
 * Covers all 6 helpers (IR-1 through IR-6), name validation (EC-1, EC-2),
 * and boundary cases (AC-31, AC-32, AC-33).
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { p } from '../src/index.js';

// ============================================================
// NAME VALIDATION (EC-1, EC-2)
// ============================================================

describe('name validation', () => {
  describe('empty name (EC-1)', () => {
    it('p.str throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.str('')).toThrow(RuntimeError);
      expect(() => p.str('')).toThrow('param name must not be empty');
    });

    it('p.num throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.num('')).toThrow(RuntimeError);
      expect(() => p.num('')).toThrow('param name must not be empty');
    });

    it('p.bool throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.bool('')).toThrow(RuntimeError);
      expect(() => p.bool('')).toThrow('param name must not be empty');
    });

    it('p.dict throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.dict('')).toThrow(RuntimeError);
      expect(() => p.dict('')).toThrow('param name must not be empty');
    });

    it('p.list throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.list('')).toThrow(RuntimeError);
      expect(() => p.list('')).toThrow('param name must not be empty');
    });

    it('p.callable throws RuntimeError RILL-R001 for empty name', () => {
      expect(() => p.callable('')).toThrow(RuntimeError);
      expect(() => p.callable('')).toThrow('param name must not be empty');
    });

    it('error has errorId RILL-R001', () => {
      let caught: unknown;
      try {
        p.str('');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });
  });

  describe('whitespace name (EC-2)', () => {
    it('p.str throws RuntimeError RILL-R001 for name with space', () => {
      expect(() => p.str('my param')).toThrow(RuntimeError);
      expect(() => p.str('my param')).toThrow('param name must be a valid identifier');
    });

    it('p.num throws RuntimeError RILL-R001 for name with tab', () => {
      expect(() => p.num('my\tparam')).toThrow(RuntimeError);
      expect(() => p.num('my\tparam')).toThrow('param name must be a valid identifier');
    });

    it('p.bool throws RuntimeError RILL-R001 for name with newline', () => {
      expect(() => p.bool('my\nparam')).toThrow(RuntimeError);
      expect(() => p.bool('my\nparam')).toThrow('param name must be a valid identifier');
    });

    it('p.list throws RuntimeError RILL-R001 for name with leading space', () => {
      expect(() => p.list(' items')).toThrow(RuntimeError);
      expect(() => p.list(' items')).toThrow('param name must be a valid identifier');
    });

    it('whitespace error has errorId RILL-R001', () => {
      let caught: unknown;
      try {
        p.str('bad name');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });
  });
});

// ============================================================
// p.str (IR-1)
// ============================================================

describe('p.str', () => {
  it('returns RillParam with type string and no desc', () => {
    const result = p.str('text');
    expect(result.name).toBe('text');
    expect(result.type).toEqual({ type: 'string' });
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('includes description in annotations when provided', () => {
    const result = p.str('text', 'The input text');
    expect(result.annotations).toEqual({ description: 'The input text' });
  });

  it('omits description key entirely when desc is not provided', () => {
    const result = p.str('text');
    expect('description' in result.annotations).toBe(false);
  });

  it('returns 4-field RillParam shape (AC-23)', () => {
    const result = p.str('x');
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['name', 'type', 'defaultValue', 'annotations'])
    );
  });
});

// ============================================================
// p.num (IR-2)
// ============================================================

describe('p.num', () => {
  it('returns RillParam with type number, no desc, no default', () => {
    const result = p.num('count');
    expect(result.name).toBe('count');
    expect(result.type).toEqual({ type: 'number' });
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('includes description when provided', () => {
    const result = p.num('count', 'Number of items');
    expect(result.annotations).toEqual({ description: 'Number of items' });
  });

  it('includes defaultValue when provided', () => {
    const result = p.num('temp', 'Temperature', 0.7);
    expect(result.defaultValue).toBe(0.7);
  });

  it('preserves defaultValue of 0', () => {
    const result = p.num('limit', undefined, 0);
    expect(result.defaultValue).toBe(0);
  });

  it('preserves negative defaultValue', () => {
    const result = p.num('offset', undefined, -1);
    expect(result.defaultValue).toBe(-1);
  });
});

// ============================================================
// p.bool (IR-3)
// ============================================================

describe('p.bool', () => {
  it('returns RillParam with type bool, no desc, no default', () => {
    const result = p.bool('enabled');
    expect(result.name).toBe('enabled');
    expect(result.type).toEqual({ type: 'bool' });
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('includes description when provided', () => {
    const result = p.bool('enabled', 'Whether to enable feature');
    expect(result.annotations).toEqual({ description: 'Whether to enable feature' });
  });

  it('includes defaultValue true when provided', () => {
    const result = p.bool('stream', undefined, true);
    expect(result.defaultValue).toBe(true);
  });

  it('includes defaultValue false when provided', () => {
    const result = p.bool('stream', undefined, false);
    expect(result.defaultValue).toBe(false);
  });
});

// ============================================================
// p.dict (IR-4)
// ============================================================

describe('p.dict', () => {
  it('returns RillParam with type dict, no desc, no default', () => {
    const result = p.dict('options');
    expect(result.name).toBe('options');
    expect(result.type).toEqual({ type: 'dict' });
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('includes description when provided', () => {
    const result = p.dict('options', 'Configuration options');
    expect(result.annotations).toEqual({ description: 'Configuration options' });
  });

  it('includes defaultValue when provided', () => {
    const def = { key: 'value' };
    const result = p.dict('options', undefined, def);
    expect(result.defaultValue).toEqual({ key: 'value' });
  });

  it('accepts null as defaultValue (RillValue)', () => {
    const result = p.dict('options', undefined, null);
    expect(result.defaultValue).toBeNull();
  });
});

// ============================================================
// p.list (IR-5, AC-31, AC-32)
// ============================================================

describe('p.list', () => {
  it('returns type list with no element when itemType absent (AC-31)', () => {
    const result = p.list('items');
    expect(result.name).toBe('items');
    expect(result.type).toEqual({ type: 'list' });
    expect('element' in result.type).toBe(false);
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('returns type list with element when itemType provided (AC-32)', () => {
    const result = p.list('items', { type: 'string' });
    expect(result.type).toEqual({ type: 'list', element: { type: 'string' } });
  });

  it('includes element for number itemType', () => {
    const result = p.list('scores', { type: 'number' });
    expect(result.type).toEqual({ type: 'list', element: { type: 'number' } });
  });

  it('includes element for nested list itemType', () => {
    const result = p.list('matrix', { type: 'list', element: { type: 'number' } });
    expect(result.type).toEqual({
      type: 'list',
      element: { type: 'list', element: { type: 'number' } },
    });
  });

  it('includes description when provided', () => {
    const result = p.list('tags', undefined, 'List of tags');
    expect(result.annotations).toEqual({ description: 'List of tags' });
  });

  it('includes description with itemType', () => {
    const result = p.list('tags', { type: 'string' }, 'List of tags');
    expect(result.annotations).toEqual({ description: 'List of tags' });
    expect(result.type).toEqual({ type: 'list', element: { type: 'string' } });
  });
});

// ============================================================
// p.callable (IR-6)
// ============================================================

describe('p.callable', () => {
  it('returns RillParam with type closure, no desc', () => {
    const result = p.callable('handler');
    expect(result.name).toBe('handler');
    expect(result.type).toEqual({ type: 'closure' });
    expect(result.defaultValue).toBeUndefined();
    expect(result.annotations).toEqual({});
  });

  it('includes description when provided', () => {
    const result = p.callable('handler', 'The callback function');
    expect(result.annotations).toEqual({ description: 'The callback function' });
  });
});

// ============================================================
// AC-33: empty string defaultValue is preserved (not treated as undefined)
// ============================================================

describe('AC-33: empty string defaultValue preservation', () => {
  it('p.dict with empty string defaultValue preserves it', () => {
    const result = p.dict('key', undefined, '');
    expect(result.defaultValue).toBe('');
  });

  it('p.num with 0 defaultValue preserves it (not treated as absent)', () => {
    const result = p.num('x', undefined, 0);
    expect(result.defaultValue).toBe(0);
  });

  it('p.bool with false defaultValue preserves it (not treated as absent)', () => {
    const result = p.bool('flag', undefined, false);
    expect(result.defaultValue).toBe(false);
  });
});

// ============================================================
// AC-23: 4-field shape across all helpers
// ============================================================

describe('AC-23: RillParam 4-field shape', () => {
  const cases = [
    p.str('a'),
    p.num('b'),
    p.bool('c'),
    p.dict('d'),
    p.list('e'),
    p.callable('f'),
  ];

  for (const param of cases) {
    it(`param '${param.name}' has name, type, defaultValue, annotations`, () => {
      expect(param).toHaveProperty('name');
      expect(param).toHaveProperty('type');
      expect(param).toHaveProperty('defaultValue');
      expect(param).toHaveProperty('annotations');
    });
  }
});
