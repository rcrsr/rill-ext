/**
 * Test suite for search configuration validation utilities.
 * Validates the error contracts.
 */

import { describe, it, expect } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RillValue,
} from '@rcrsr/rill';
import {
  appendQueryOptions,
  assertRequired,
  validateBaseUrl,
} from './validation.js';

describe('assertRequired', () => {
  describe('Throws for missing values', () => {
    it('throws for undefined', () => {
      expect(() => assertRequired(undefined, 'apiKey')).toThrow(
        'apiKey is required'
      );
    });

    it('throws for null', () => {
      expect(() => assertRequired(null, 'apiKey')).toThrow(
        'apiKey is required'
      );
    });

    it('throws for empty string', () => {
      expect(() => assertRequired('', 'apiKey')).toThrow('apiKey is required');
    });

    it('includes field name in error message', () => {
      expect(() => assertRequired(undefined, 'baseUrl')).toThrow(
        'baseUrl is required'
      );
    });
  });

  describe('Valid values pass validation', () => {
    it('allows zero (0) — valid numeric value', () => {
      expect(() => assertRequired(0, 'timeout')).not.toThrow();
    });

    it('allows non-empty string', () => {
      expect(() => assertRequired('sk-abc123', 'apiKey')).not.toThrow();
    });

    it('allows non-zero number', () => {
      expect(() => assertRequired(30000, 'timeout')).not.toThrow();
    });

    it('allows false boolean', () => {
      expect(() => assertRequired(false, 'enabled')).not.toThrow();
    });
  });
});

describe('validateBaseUrl', () => {
  describe('Throws for invalid URL schemes', () => {
    it('throws for ftp:// URL', () => {
      expect(() => validateBaseUrl('ftp://example.com')).toThrow(
        'baseUrl must start with http:// or https://'
      );
    });

    it('throws for URL with no protocol', () => {
      expect(() => validateBaseUrl('example.com')).toThrow(
        'baseUrl must start with http:// or https://'
      );
    });

    it('throws for empty string', () => {
      expect(() => validateBaseUrl('')).toThrow(
        'baseUrl must start with http:// or https://'
      );
    });

    it('throws for relative path', () => {
      expect(() => validateBaseUrl('/api/search')).toThrow(
        'baseUrl must start with http:// or https://'
      );
    });
  });

  describe('Valid URLs pass validation', () => {
    it('accepts http:// URL', () => {
      expect(() =>
        validateBaseUrl('http://my-search.example.com')
      ).not.toThrow();
    });

    it('accepts https:// URL', () => {
      expect(() =>
        validateBaseUrl('https://my-search.example.com')
      ).not.toThrow();
    });

    it('accepts https:// URL with path', () => {
      expect(() => validateBaseUrl('https://api.example.com/v1')).not.toThrow();
    });
  });
});

describe('appendQueryOptions', () => {
  const ctx = createRuntimeContext();

  it('sets string, number and boolean options in key order', () => {
    const params = new URLSearchParams();
    appendQueryOptions(ctx, 'test', params, { b: 2, a: 'x', c: true }, [
      'a',
      'b',
      'c',
    ]);
    expect(params.toString()).toBe('a=x&b=2&c=true');
  });

  it('skips undefined options', () => {
    const params = new URLSearchParams();
    appendQueryOptions(ctx, 'test', params, { a: 'x' }, ['a', 'b']);
    expect(params.toString()).toBe('a=x');
  });

  it.each([
    ['dict', { nested: 1 }],
    ['list', [1, 2]],
  ])('throws invalid_option_type for %s value', (_label, value) => {
    const params = new URLSearchParams();
    let thrown: unknown;
    try {
      appendQueryOptions(ctx, 'test', params, { a: value }, ['a']);
    } catch (e: unknown) {
      thrown = e;
    }
    expect(isInvalid(thrown as RillValue)).toBe(true);
    const status = getStatus(thrown as RillValue);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.raw['kind']).toBe('invalid_option_type');
    expect(status.raw['option']).toBe('a');
  });
});
