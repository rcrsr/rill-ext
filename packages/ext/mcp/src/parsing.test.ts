/**
 * Tests for JSON Schema to rill type mapping utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  mapJsonSchemaTypeToRillType,
  sanitizeParameterName,
  generateParametersFromSchema,
  jsonSchemaPropertyToRillParam,
  parseResourceContent,
  type JsonSchema,
  type JsonSchemaProperty,
  type ResourceReadResult,
} from './parsing.js';

describe('mapJsonSchemaTypeToRillType', () => {
  describe('Type Mapping', () => {
    it.each<{ title: string; property: JsonSchemaProperty; expected: string }>([
      {
        title: 'maps string to string',
        property: { type: 'string' },
        expected: 'string',
      },
      {
        title: 'maps integer to number',
        property: { type: 'integer' },
        expected: 'number',
      },
      {
        title: 'maps number to number',
        property: { type: 'number' },
        expected: 'number',
      },
      {
        title: 'maps boolean to bool',
        property: { type: 'boolean' },
        expected: 'bool',
      },
      {
        title: 'maps object to dict',
        property: { type: 'object' },
        expected: 'dict',
      },
      {
        title: 'maps array to list',
        property: { type: 'array' },
        expected: 'list',
      },
      {
        title: 'maps enum to string',
        property: { type: 'string', enum: ['option1', 'option2'] },
        expected: 'string',
      },
      {
        title: 'maps oneOf to string',
        property: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        expected: 'string',
      },
      {
        title: 'maps anyOf to string',
        property: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        expected: 'string',
      },
      { title: 'maps missing type to dict', property: {}, expected: 'dict' },
    ])('$title', ({ property, expected }) => {
      expect(mapJsonSchemaTypeToRillType(property)).toBe(expected);
    });
  });
});

describe('sanitizeParameterName', () => {
  it('replaces hyphens with underscores', () => {
    expect(sanitizeParameterName('file-path')).toBe('file_path');
  });

  it('replaces dots with underscores', () => {
    expect(sanitizeParameterName('config.option')).toBe('config_option');
  });

  it('converts camelCase to snake_case', () => {
    expect(sanitizeParameterName('fileName')).toBe('file_name');
  });

  it('converts PascalCase to snake_case', () => {
    expect(sanitizeParameterName('FileName')).toBe('file_name');
  });

  it('handles multiple transformations', () => {
    expect(sanitizeParameterName('get.fileName')).toBe('get_file_name');
  });

  it('handles consecutive uppercase letters', () => {
    expect(sanitizeParameterName('XMLParser')).toBe('xml_parser');
  });

  it('preserves already snake_case names', () => {
    expect(sanitizeParameterName('file_name')).toBe('file_name');
  });

  it('normalizes consecutive underscores', () => {
    expect(sanitizeParameterName('file__name')).toBe('file_name');
  });

  it('strips leading underscores', () => {
    expect(sanitizeParameterName('_fileName')).toBe('file_name');
  });

  it('strips trailing underscores', () => {
    expect(sanitizeParameterName('fileName_')).toBe('file_name');
  });
});

describe('jsonSchemaPropertyToRillParam', () => {
  it('maps string property to p.str', () => {
    const param = jsonSchemaPropertyToRillParam('name', {
      type: 'string',
      description: 'User name',
    });
    expect(param).toEqual({
      name: 'name',
      type: { kind: 'string' },
      defaultValue: undefined,
      annotations: { description: 'User name' },
    });
  });

  it('maps integer property to p.num', () => {
    const param = jsonSchemaPropertyToRillParam('count', {
      type: 'integer',
      description: 'Item count',
    });
    expect(param).toEqual({
      name: 'count',
      type: { kind: 'number' },
      defaultValue: undefined,
      annotations: { description: 'Item count' },
    });
  });

  it.each<{
    title: string;
    name: string;
    property: JsonSchemaProperty;
    kind: string;
  }>([
    {
      title: 'maps number property to p.num',
      name: 'score',
      property: { type: 'number' },
      kind: 'number',
    },
    {
      title: 'maps boolean property to p.bool',
      name: 'enabled',
      property: { type: 'boolean' },
      kind: 'bool',
    },
    {
      title: 'maps object property to p.dict',
      name: 'config',
      property: { type: 'object' },
      kind: 'dict',
    },
    {
      title: 'maps array property to p.list',
      name: 'items',
      property: { type: 'array' },
      kind: 'list',
    },
    {
      title: 'maps enum to p.str',
      name: 'status',
      property: { type: 'string', enum: ['a', 'b'] },
      kind: 'string',
    },
    {
      title: 'maps missing type to p.dict',
      name: 'data',
      property: {},
      kind: 'dict',
    },
  ])('$title', ({ name, property, kind }) => {
    const param = jsonSchemaPropertyToRillParam(name, property);
    expect(param.type).toEqual({ kind });
  });

  it('omits description from annotations when absent', () => {
    const param = jsonSchemaPropertyToRillParam('x', { type: 'string' });
    expect(param.annotations).toEqual({});
  });
});

describe('generateParametersFromSchema', () => {
  describe('RillParam Output Shape', () => {
    it('generates RillParam with correct types from properties', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'integer', description: 'User age' },
        },
        required: ['name'],
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(2);
      expect(params[0]).toEqual({
        name: 'name',
        type: { kind: 'string' },
        defaultValue: undefined,
        annotations: { description: 'User name' },
      });
      expect(params[1]).toEqual({
        name: 'age',
        type: { kind: 'number' },
        defaultValue: undefined,
        annotations: { description: 'User age' },
      });
    });

    it('maps each JSON Schema type to correct rill type', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          str_param: { type: 'string' },
          num_param: { type: 'number' },
          bool_param: { type: 'boolean' },
          list_param: { type: 'array' },
          dict_param: { type: 'object' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(5);
      expect(params[0]!.type).toEqual({ kind: 'string' });
      expect(params[1]!.type).toEqual({ kind: 'number' });
      expect(params[2]!.type).toEqual({ kind: 'bool' });
      expect(params[3]!.type).toEqual({ kind: 'list' });
      expect(params[4]!.type).toEqual({ kind: 'dict' });
      for (const param of params) {
        expect(param.defaultValue).toBeUndefined();
      }
    });

    it('preserves Object.entries iteration order', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          zulu: { type: 'string' },
          alpha: { type: 'string' },
          bravo: { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(3);
      expect(params[0]!.name).toBe('zulu');
      expect(params[1]!.name).toBe('alpha');
      expect(params[2]!.name).toBe('bravo');
    });

    it('sanitizes parameter names', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          'file-path': { type: 'string' },
          fileName: { type: 'string' },
          'config.option': { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(3);
      expect(params[0]!.name).toBe('file_path');
      expect(params[1]!.name).toBe('file_name');
      expect(params[2]!.name).toBe('config_option');
    });

    it('places description in annotations.description', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param: { type: 'string', description: 'Test parameter' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0]!.annotations).toEqual({ description: 'Test parameter' });
    });

    it('uses empty annotations when description is absent', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          param: { type: 'string' },
        },
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toHaveLength(1);
      expect(params[0]!.annotations).toEqual({});
    });

    it('returns empty array for missing properties', () => {
      const schema: JsonSchema = {
        type: 'object',
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles empty properties object', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {},
      };

      const params = generateParametersFromSchema(schema);

      expect(params).toEqual([]);
    });
  });
});

describe('parseResourceContent', () => {
  describe('Resource Content Parsing', () => {
    it('parses text content as string', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://test.txt',
            text: 'plain text content',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('plain text content');
    });

    it('parses valid JSON text content as dict', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://config.json',
            text: '{"key": "value", "num": 42}',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({ key: 'value', num: 42 });
    });

    it('parses invalid JSON text as string', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://data.txt',
            text: '{not valid json}',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('{not valid json}');
    });

    it('parses blob content as dict with type/data/mime', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://image.png',
            blob: 'iVBORw0KGgoAAAANS',
            mimeType: 'image/png',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'iVBORw0KGgoAAAANS',
        mime: 'image/png',
      });
    });

    it('uses default mime type for blob without mimeType', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://binary.dat',
            blob: 'YmluYXJ5IGRhdGE=',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'YmluYXJ5IGRhdGE=',
        mime: 'application/octet-stream',
      });
    });

    it('concatenates multiple text blocks with newlines', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://part1.txt', text: 'first line' },
          { uri: 'file://part2.txt', text: 'second line' },
          { uri: 'file://part3.txt', text: 'third line' },
        ],
      };

      expect(parseResourceContent(result)).toBe(
        'first line\nsecond line\nthird line'
      );
    });
  });

  describe('Zero-Byte Resource', () => {
    it('returns empty string for empty content array', () => {
      const result: ResourceReadResult = {
        contents: [],
      };

      expect(parseResourceContent(result)).toBe('');
    });

    it('returns empty string for empty text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://empty.txt',
            text: '',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('');
    });

    it('returns empty string for content with no text or blob', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://nothing.dat',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles JSON array in text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://array.json',
            text: '[1, 2, 3]',
          },
        ],
      };

      // JSON arrays are returned as-is (not wrapped in dict)
      expect(parseResourceContent(result)).toEqual([1, 2, 3]);
    });

    it('handles JSON primitive in text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://number.json',
            text: '42',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe(42);
    });

    it('handles whitespace-only text content', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://whitespace.txt',
            text: '   \n\t  ',
          },
        ],
      };

      expect(parseResourceContent(result)).toBe('   \n\t  ');
    });

    it('returns first content block for mixed text and blob', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://text.txt', text: 'text content' },
          {
            uri: 'file://image.png',
            blob: 'base64data',
            mimeType: 'image/png',
          },
        ],
      };

      // First block is text, so return that
      expect(parseResourceContent(result)).toBe('text content');
    });

    it('returns first blob for multiple blob blocks', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://image1.png', blob: 'data1', mimeType: 'image/png' },
          { uri: 'file://image2.png', blob: 'data2', mimeType: 'image/png' },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        type: 'image',
        data: 'data1',
        mime: 'image/png',
      });
    });

    it('handles empty text in multiple text blocks', () => {
      const result: ResourceReadResult = {
        contents: [
          { uri: 'file://part1.txt', text: 'first' },
          { uri: 'file://part2.txt', text: '' },
          { uri: 'file://part3.txt', text: 'third' },
        ],
      };

      expect(parseResourceContent(result)).toBe('first\n\nthird');
    });

    it('handles nested JSON objects', () => {
      const result: ResourceReadResult = {
        contents: [
          {
            uri: 'file://nested.json',
            text: '{"outer": {"inner": {"deep": "value"}}}',
          },
        ],
      };

      expect(parseResourceContent(result)).toEqual({
        outer: { inner: { deep: 'value' } },
      });
    });
  });
});
