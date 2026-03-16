import { describe, it, expect } from 'vitest';
import { type ApplicationCallable } from '@rcrsr/rill';
import { createQdrantExtension } from '../src/factory.js';

/**
 * Extract a named ApplicationCallable from an ExtensionFactoryResult value dict.
 */
function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

describe('createQdrantExtension', () => {
  describe('configuration validation', () => {
    it('throws Error for missing url (AC-10)', () => {
      expect(() =>
        createQdrantExtension({
          url: undefined as unknown as string,
          collection: 'test',
        })
      ).toThrow('url is required');
    });

    it('throws Error for empty url (AC-10)', () => {
      expect(() =>
        createQdrantExtension({
          url: '',
          collection: 'test',
        })
      ).toThrow('url is required');
    });

    it('throws Error for missing collection (AC-10)', () => {
      expect(() =>
        createQdrantExtension({
          url: 'http://localhost:6333',
          collection: undefined as unknown as string,
        })
      ).toThrow('collection is required');
    });

    it('throws Error for empty collection (AC-10)', () => {
      expect(() =>
        createQdrantExtension({
          url: 'http://localhost:6333',
          collection: '',
        })
      ).toThrow('collection is required');
    });
  });

  describe('factory return value', () => {
    it('returns ExtensionResult with all 11 functions', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // Verify all 11 functions are present
      expect(getCallable(ext, 'upsert')).toBeDefined();
      expect(getCallable(ext, 'upsert_batch')).toBeDefined();
      expect(getCallable(ext, 'search')).toBeDefined();
      expect(getCallable(ext, 'get')).toBeDefined();
      expect(getCallable(ext, 'delete')).toBeDefined();
      expect(getCallable(ext, 'delete_batch')).toBeDefined();
      expect(getCallable(ext, 'count')).toBeDefined();
      expect(getCallable(ext, 'create_collection')).toBeDefined();
      expect(getCallable(ext, 'delete_collection')).toBeDefined();
      expect(getCallable(ext, 'list_collections')).toBeDefined();
      expect(getCallable(ext, 'describe')).toBeDefined();

      // Verify dispose is present
      expect(ext.dispose).toBeDefined();
      expect(typeof ext.dispose).toBe('function');
    });

    it('creates functions with correct signatures (IR-1)', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // IR-1: upsert signature
      const upsert = getCallable(ext, 'upsert');
      expect(upsert.params).toEqual([
        { name: 'id', type: { kind: 'string' }, defaultValue: undefined, annotations: {} },
        { name: 'vector', type: { kind: 'vector' }, defaultValue: undefined, annotations: {} },
        { name: 'metadata', type: { kind: 'dict' }, defaultValue: {}, annotations: {} },
      ]);
      expect(upsert.returnType).toBeDefined();
      expect(upsert.annotations?.['description']).toBe(
        'Insert or update single vector with metadata'
      );
    });

    it('creates functions with correct signatures (IR-3)', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // IR-3: search signature
      const search = getCallable(ext, 'search');
      expect(search.params).toEqual([
        { name: 'vector', type: { kind: 'vector' }, defaultValue: undefined, annotations: {} },
        { name: 'options', type: { kind: 'dict', fields: {
          k: { type: { kind: 'number' }, defaultValue: 10 },
          filter: { type: { kind: 'dict' }, defaultValue: {} },
          score_threshold: { type: { kind: 'number' }, defaultValue: 0 },
        } }, defaultValue: {}, annotations: {} },
      ]);
      expect(search.returnType).toBeDefined();
      expect(search.annotations?.['description']).toBe('Search k nearest neighbors');
    });

    it('creates functions with correct signatures (IR-7)', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // IR-7: count signature
      const count = getCallable(ext, 'count');
      expect(count.params).toEqual([]);
      expect(count.returnType).toBeDefined();
      expect(count.annotations?.['description']).toBe(
        'Return total vector count in collection'
      );
    });
  });

  describe('dispose lifecycle (AC-31, AC-32)', () => {
    it('dispose is idempotent', async () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // AC-32: Multiple calls to dispose should not throw
      await ext.dispose!();
      await ext.dispose!();
      await ext.dispose!();

      // No error expected
      expect(true).toBe(true);
    });
  });
});
