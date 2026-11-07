/**
 * Test suite for validation utilities.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { assertRequired } from '../src/validation.js';

function captureThrown(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('assertRequired', () => {
  describe('missing values throw', () => {
    it.each([
      { label: 'undefined', value: undefined, field: 'field' },
      { label: 'undefined', value: undefined, field: 'apiKey' },
      { label: 'null', value: null, field: 'field' },
      { label: 'null', value: null, field: 'endpoint' },
      { label: 'empty string', value: '', field: 'field' },
      { label: 'empty string', value: '', field: 'apiKey' },
    ])('throws RILL-R001 for $label with field $field', ({ value, field }) => {
      const thrown = captureThrown(() => assertRequired(value, field));
      expect(thrown).toBeInstanceOf(RuntimeError);
      expect((thrown as RuntimeError).errorId).toBe('RILL-R001');
      expect((thrown as RuntimeError).message).toContain(
        `${field} is required`
      );
    });
  });

  describe('present values pass', () => {
    it.each([
      { label: 'non-empty string', value: 'valid' },
      { label: 'string with spaces', value: '  spaces  ' },
      { label: 'single character', value: 'a' },
      { label: 'number zero', value: 0 },
      { label: 'positive number', value: 100 },
      { label: 'negative number', value: -1 },
      { label: 'boolean true', value: true },
      { label: 'boolean false', value: false },
      { label: 'object', value: { key: 'value' } },
      { label: 'array', value: [1, 2, 3] },
      { label: 'empty array', value: [] },
    ])('passes for $label', ({ value }) => {
      expect(() => assertRequired(value, 'field')).not.toThrow();
    });
  });
});
