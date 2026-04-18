/**
 * Unit tests for typeRefToStructure.
 *
 * Covers:
 *   - Bare scalars → { kind: ... }
 *   - list / dict bare → { kind: 'list' } / { kind: 'dict' }
 *   - list(string) → { kind: 'list', element: { kind: 'string' } }
 *   - dict(string) → { kind: 'dict', valueType: { kind: 'string' } }
 *   - dict(a: string, b: number) → fields form
 *   - list(dict(a: string, b: string)) → nested
 *   - dynamic ref rejection
 *   - union ref rejection
 *   - mixed named/positional args in dict(...) rejected
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError, type TypeRef } from '@rcrsr/rill';
import { typeRefToStructure } from './typeRefToStructure.js';

// ============================================================
// BARE SCALARS
// ============================================================

describe('typeRefToStructure', () => {
  describe('bare scalars', () => {
    const scalars = ['string', 'number', 'bool', 'any', 'closure'] as const;
    for (const typeName of scalars) {
      it(`converts bare ${typeName}`, () => {
        const ref: TypeRef = { kind: 'static', typeName };
        const result = typeRefToStructure(ref);
        expect(result).toEqual({ kind: typeName });
      });
    }
  });

  // ============================================================
  // BARE PARAMETERIZABLE TYPES
  // ============================================================

  describe('bare list and dict', () => {
    it('converts bare list', () => {
      const ref: TypeRef = { kind: 'static', typeName: 'list' };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({ kind: 'list' });
    });

    it('converts bare dict', () => {
      const ref: TypeRef = { kind: 'static', typeName: 'dict' };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({ kind: 'dict' });
    });
  });

  // ============================================================
  // PARAMETERIZED list
  // ============================================================

  describe('list(T)', () => {
    it('converts list(string)', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'list',
        args: [{ value: { kind: 'static', typeName: 'string' } }],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({ kind: 'list', element: { kind: 'string' } });
    });

    it('converts list(number)', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'list',
        args: [{ value: { kind: 'static', typeName: 'number' } }],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({ kind: 'list', element: { kind: 'number' } });
    });

    it('rejects list with named arg', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'list',
        args: [{ name: 'T', value: { kind: 'static', typeName: 'string' } }],
      };
      expect(() => typeRefToStructure(ref)).toThrow(RuntimeError);
    });

    it('rejects list with multiple positional args', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'list',
        args: [
          { value: { kind: 'static', typeName: 'string' } },
          { value: { kind: 'static', typeName: 'number' } },
        ],
      };
      expect(() => typeRefToStructure(ref)).toThrow(RuntimeError);
    });
  });

  // ============================================================
  // PARAMETERIZED dict
  // ============================================================

  describe('dict(T) — positional (valueType)', () => {
    it('converts dict(string)', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'dict',
        args: [{ value: { kind: 'static', typeName: 'string' } }],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({ kind: 'dict', valueType: { kind: 'string' } });
    });

    it('rejects dict with multiple positional args', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'dict',
        args: [
          { value: { kind: 'static', typeName: 'string' } },
          { value: { kind: 'static', typeName: 'number' } },
        ],
      };
      expect(() => typeRefToStructure(ref)).toThrow(RuntimeError);
    });
  });

  describe('dict(a: T, b: T) — named (fields)', () => {
    it('converts dict(a: string, b: number)', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'dict',
        args: [
          { name: 'a', value: { kind: 'static', typeName: 'string' } },
          { name: 'b', value: { kind: 'static', typeName: 'number' } },
        ],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({
        kind: 'dict',
        fields: {
          a: { type: { kind: 'string' } },
          b: { type: { kind: 'number' } },
        },
      });
    });

    it('converts dict(title: string, body: string)', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'dict',
        args: [
          { name: 'title', value: { kind: 'static', typeName: 'string' } },
          { name: 'body', value: { kind: 'static', typeName: 'string' } },
        ],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({
        kind: 'dict',
        fields: {
          title: { type: { kind: 'string' } },
          body: { type: { kind: 'string' } },
        },
      });
    });
  });

  // ============================================================
  // NESTED
  // ============================================================

  describe('nested types', () => {
    it('converts list(dict(a: string, b: string))', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'list',
        args: [
          {
            value: {
              kind: 'static',
              typeName: 'dict',
              args: [
                { name: 'a', value: { kind: 'static', typeName: 'string' } },
                { name: 'b', value: { kind: 'static', typeName: 'string' } },
              ],
            },
          },
        ],
      };
      const result = typeRefToStructure(ref);
      expect(result).toEqual({
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
  });

  // ============================================================
  // REJECTION CASES
  // ============================================================

  describe('dynamic ref rejection', () => {
    it('throws RuntimeError with RILL-R001 for dynamic ref', () => {
      const ref: TypeRef = { kind: 'dynamic', varName: 'T' };
      try {
        typeRefToStructure(ref);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });

    it('mentions the variable name in the error message', () => {
      const ref: TypeRef = { kind: 'dynamic', varName: 'MyType' };
      try {
        typeRefToStructure(ref);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as RuntimeError).message).toContain('$MyType');
      }
    });
  });

  describe('union ref rejection', () => {
    it('throws RuntimeError with RILL-R001 for union ref', () => {
      const ref: TypeRef = {
        kind: 'union',
        members: [
          { kind: 'static', typeName: 'string' },
          { kind: 'static', typeName: 'number' },
        ],
      };
      try {
        typeRefToStructure(ref);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });
  });

  describe('mixed named/positional args in dict', () => {
    it('throws RuntimeError for mixed args', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'dict',
        args: [
          { value: { kind: 'static', typeName: 'string' } },
          { name: 'b', value: { kind: 'static', typeName: 'number' } },
        ],
      };
      try {
        typeRefToStructure(ref);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RuntimeError);
        expect((err as RuntimeError).errorId).toBe('RILL-R001');
      }
    });
  });

  describe('unsupported parameterized type', () => {
    it('throws RuntimeError for parameterized tuple', () => {
      const ref: TypeRef = {
        kind: 'static',
        typeName: 'tuple',
        args: [{ value: { kind: 'static', typeName: 'string' } }],
      };
      expect(() => typeRefToStructure(ref)).toThrow(RuntimeError);
    });
  });
});
