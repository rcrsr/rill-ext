import { describe, it, expect } from 'vitest';
import { createQdrantExtension } from '../src/factory.js';

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
      expect(ext.upsert).toBeDefined();
      expect(ext.upsert_batch).toBeDefined();
      expect(ext.search).toBeDefined();
      expect(ext.get).toBeDefined();
      expect(ext.delete).toBeDefined();
      expect(ext.delete_batch).toBeDefined();
      expect(ext.count).toBeDefined();
      expect(ext.create_collection).toBeDefined();
      expect(ext.delete_collection).toBeDefined();
      expect(ext.list_collections).toBeDefined();
      expect(ext.describe).toBeDefined();

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
      expect(ext.upsert.params).toEqual([
        { name: 'id', type: { type: 'string' }, defaultValue: undefined, annotations: {} },
        { name: 'vector', type: { type: 'vector' }, defaultValue: undefined, annotations: {} },
        { name: 'metadata', type: { type: 'dict' }, defaultValue: {}, annotations: {} },
      ]);
      expect(ext.upsert.returnType).toBeDefined();
      expect(ext.upsert.annotations?.['description']).toBe(
        'Insert or update single vector with metadata'
      );
    });

    it('creates functions with correct signatures (IR-3)', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // IR-3: search signature
      expect(ext.search.params).toEqual([
        { name: 'vector', type: { type: 'vector' }, defaultValue: undefined, annotations: {} },
        { name: 'options', type: { type: 'dict', fields: {
          k: { type: { type: 'number' }, defaultValue: 10 },
          filter: { type: { type: 'dict' }, defaultValue: {} },
          score_threshold: { type: { type: 'number' }, defaultValue: 0 },
        } }, defaultValue: {}, annotations: {} },
      ]);
      expect(ext.search.returnType).toBeDefined();
      expect(ext.search.annotations?.['description']).toBe('Search k nearest neighbors');
    });

    it('creates functions with correct signatures (IR-7)', () => {
      const ext = createQdrantExtension({
        url: 'http://localhost:6333',
        collection: 'test_collection',
      });

      // IR-7: count signature
      expect(ext.count.params).toEqual([]);
      expect(ext.count.returnType).toBeDefined();
      expect(ext.count.annotations?.['description']).toBe(
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
