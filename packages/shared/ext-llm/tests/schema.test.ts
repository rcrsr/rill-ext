/**
 * Unit tests for buildJsonSchemaFromStructuralType.
 *
 * Covers closure variant (tool parameters), dict variant (structured output),
 * and error contracts.
 *
 * AC-10: closure output matches expected JSON Schema
 * AC-18: unsupported type in param position → RILL-R004
 * EC-3: closure/tuple kind in param position → RILL-R004
 */

import { describe, it, expect } from 'vitest';
import { type RillParam, RuntimeError } from '@rcrsr/rill';
import { buildJsonSchemaFromStructuralType } from '../src/schema.js';

// ============================================================
// AC-10, AC-18, EC-3: buildJsonSchemaFromStructuralType (closure variant)
// ============================================================

describe('buildJsonSchemaFromStructuralType', () => {
  describe('closure TypeStructure', () => {
    // AC-10: output identical to equivalent legacy schema for same param structure
    it('AC-10: string param produces same output as buildJsonSchema string type', () => {
      const params: RillParam[] = [
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'name', type: { kind: 'string' } }],
        },
        params
      );
      expect(result.properties['name']?.type).toBe('string');
      expect(result.required).toContain('name');
      expect(result.type).toBe('object');
      expect(result.additionalProperties).toBe(false);
    });

    it('AC-10: number param produces same output as buildJsonSchema number type', () => {
      const params: RillParam[] = [
        {
          name: 'count',
          type: { kind: 'number' },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'count', type: { kind: 'number' } }],
        },
        params
      );
      expect(result.properties['count']?.type).toBe('number');
      expect(result.required).toContain('count');
    });

    it('AC-10: bool param produces type "boolean" matching buildJsonSchema', () => {
      const params: RillParam[] = [
        {
          name: 'active',
          type: { kind: 'bool' },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'active', type: { kind: 'bool' } }],
        },
        params
      );
      expect(result.properties['active']?.type).toBe('boolean');
    });

    it('AC-10: dict param produces type "object"', () => {
      const params: RillParam[] = [
        {
          name: 'meta',
          type: { kind: 'dict' },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'meta', type: { kind: 'dict' } }],
        },
        params
      );
      expect(result.properties['meta']?.type).toBe('object');
      expect(result.required).toContain('meta');
    });

    it('param with defaultValue !== undefined is optional (not in required)', () => {
      const params: RillParam[] = [
        {
          name: 'limit',
          type: { kind: 'number' },
          defaultValue: 10,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'limit', type: { kind: 'number' } }],
        },
        params
      );
      expect(result.required).not.toContain('limit');
    });

    it('param with defaultValue 0 is optional (falsy non-undefined value)', () => {
      const params: RillParam[] = [
        {
          name: 'offset',
          type: { kind: 'number' },
          defaultValue: 0,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'offset', type: { kind: 'number' } }],
        },
        params
      );
      expect(result.required).not.toContain('offset');
    });

    it('description annotation propagates to property', () => {
      const params: RillParam[] = [
        {
          name: 'query',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: { description: 'Search query' },
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'query', type: { kind: 'string' } }],
        },
        params
      );
      expect(result.properties['query']?.description).toBe('Search query');
    });

    it('enum annotation propagates to property', () => {
      const params: RillParam[] = [
        {
          name: 'status',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: { enum: ['active', 'inactive'] },
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'status', type: { kind: 'string' } }],
        },
        params
      );
      expect(result.properties['status']?.enum).toEqual(['active', 'inactive']);
    });

    it('empty closure produces empty properties and required arrays', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'closure',
        params: [],
      });
      expect(result.properties).toEqual({});
      expect(result.required).toEqual([]);
    });

    // AC-25: list with element maps to array with items
    it('AC-25: list type with element produces array with items in JSON Schema', () => {
      const params: RillParam[] = [
        {
          name: 'tags',
          type: { kind: 'list', element: { kind: 'string' } },
          defaultValue: undefined,
          annotations: {},
        },
      ];
      const result = buildJsonSchemaFromStructuralType(
        {
          kind: 'closure',
          params: [{ name: 'tags', type: { kind: 'list', element: { kind: 'string' } } }],
        },
        params
      );
      expect(result.properties['tags']?.type).toBe('array');
      expect(result.properties['tags']?.items?.type).toBe('string');
    });

    it('list type without element produces array with no items', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'closure',
        params: [{ name: 'items', type: { kind: 'list' } }],
      });
      expect(result.properties['items']?.type).toBe('array');
      expect(result.properties['items']?.items).toBeUndefined();
    });

    it('nested list element type recurses correctly', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'closure',
        params: [{ name: 'matrix', type: { kind: 'list', element: { kind: 'list', element: { kind: 'number' } } } }],
      });
      expect(result.properties['matrix']?.type).toBe('array');
      expect(result.properties['matrix']?.items?.type).toBe('array');
      expect(result.properties['matrix']?.items?.items?.type).toBe('number');
    });

    // AC-18 / EC-3: unsupported type throws RILL-R004
    it('AC-18/EC-3: closure type in param throws RuntimeError RILL-R004', () => {
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchemaFromStructuralType({
          kind: 'closure',
          params: [
            { name: 'fn', type: { kind: 'closure', params: [] } },
          ],
        });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect(thrown?.errorId).toBe('RILL-R004');
    });

    it('AC-18/EC-3: tuple type in param throws RuntimeError RILL-R004', () => {
      let thrown: RuntimeError | undefined;
      try {
        buildJsonSchemaFromStructuralType({
          kind: 'closure',
          params: [{ name: 't', type: { kind: 'tuple', elements: [] } }],
        });
      } catch (e) {
        thrown = e as RuntimeError;
      }
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect(thrown?.errorId).toBe('RILL-R004');
    });
  });

  // ============================================================
  // dict TypeStructure (structured output)
  // ============================================================

  describe('dict TypeStructure', () => {
    it('converts dict with string and number fields', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          age: { type: { kind: 'number' } },
        },
      });
      expect(result.type).toBe('object');
      expect(result.properties['name']?.type).toBe('string');
      expect(result.properties['age']?.type).toBe('number');
      expect(result.required).toEqual(['name', 'age']);
      expect(result.additionalProperties).toBe(false);
    });

    it('converts dict with bool field', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          active: { type: { kind: 'bool' } },
        },
      });
      expect(result.properties['active']?.type).toBe('boolean');
    });

    it('converts dict with list field', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          tags: { type: { kind: 'list', element: { kind: 'string' } } },
        },
      });
      expect(result.properties['tags']?.type).toBe('array');
      expect(result.properties['tags']?.items?.type).toBe('string');
    });

    it('converts nested dict fields', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          addr: {
            type: {
              kind: 'dict',
              fields: {
                street: { type: { kind: 'string' } },
                city: { type: { kind: 'string' } },
              },
            },
          },
        },
      });
      const addrProp = result.properties['addr'];
      expect(addrProp?.type).toBe('object');
      expect(addrProp?.properties?.['street']?.type).toBe('string');
      expect(addrProp?.properties?.['city']?.type).toBe('string');
      expect(addrProp?.required).toEqual(['street', 'city']);
      expect(addrProp?.additionalProperties).toBe(false);
    });

    it('reads description from field annotations', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          name: {
            type: { kind: 'string' },
            annotations: { description: "The user's full name" },
          },
        },
      });
      expect(result.properties['name']?.description).toBe("The user's full name");
    });

    it('marks fields with defaultValue as optional', () => {
      const result = buildJsonSchemaFromStructuralType({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          nickname: { type: { kind: 'string' }, defaultValue: '' },
        },
      });
      expect(result.required).toEqual(['name']);
    });

    it('returns empty properties for dict without fields', () => {
      const result = buildJsonSchemaFromStructuralType({ kind: 'dict' });
      expect(result.type).toBe('object');
      expect(result.properties).toEqual({});
      expect(result.required).toEqual([]);
    });

    it('returns empty properties for dict with empty fields', () => {
      const result = buildJsonSchemaFromStructuralType({ kind: 'dict', fields: {} });
      expect(result.type).toBe('object');
      expect(result.properties).toEqual({});
      expect(result.required).toEqual([]);
    });
  });
});
