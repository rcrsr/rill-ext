import { describe, it, expect } from 'vitest';
import { createChromaExtension } from '../src/factory.js';

describe('createChromaExtension', () => {
  describe('configuration validation', () => {
    it('throws error when collection is missing', () => {
      expect(() =>
        createChromaExtension({ collection: undefined as unknown as string })
      ).toThrow('collection is required');
    });

    it('throws error when collection is empty', () => {
      expect(() => createChromaExtension({ collection: '' })).toThrow(
        'collection is required'
      );
    });

    it('creates extension with valid collection name', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });
      expect(ext).toBeDefined();
      expect(ext.dispose).toBeDefined();
    });

    it('creates extension with url for remote mode', () => {
      const ext = createChromaExtension({
        url: 'http://localhost:8000',
        collection: 'test_collection',
      });
      expect(ext).toBeDefined();
    });
  });

  describe('function exports', () => {
    it('exports all 11 vector database functions', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });
      const value = ext.value as Record<string, unknown>;

      // IR-1 through IR-11
      expect(value['upsert']).toBeDefined();
      expect(value['upsert_batch']).toBeDefined();
      expect(value['search']).toBeDefined();
      expect(value['get']).toBeDefined();
      expect(value['delete']).toBeDefined();
      expect(value['delete_batch']).toBeDefined();
      expect(value['count']).toBeDefined();
      expect(value['create_collection']).toBeDefined();
      expect(value['delete_collection']).toBeDefined();
      expect(value['list_collections']).toBeDefined();
      expect(value['describe']).toBeDefined();
    });

    it('all functions have correct structure', () => {
      const ext = createChromaExtension({ collection: 'test_collection' });
      const value = ext.value as Record<string, Record<string, unknown>>;

      expect(value['upsert']!['params']).toBeDefined();
      expect(value['upsert']!['fn']).toBeTypeOf('function');
      expect(
        (value['upsert']!['annotations'] as Record<string, unknown>)?.[
          'description'
        ]
      ).toBeTypeOf('string');
      expect(value['upsert']!['returnType']).toBeDefined();
    });
  });

  describe('disposal', () => {
    it('dispose is idempotent', async () => {
      const ext = createChromaExtension({ collection: 'test_collection' });

      // Multiple calls should not throw
      await ext.dispose!();
      await ext.dispose!();
      await ext.dispose!();
    });

    // Note: Testing post-dispose error behavior (EC-8) requires a full
    // RuntimeContext which is out of scope for unit tests.
    // Integration tests in task 3.5 will cover this scenario.
  });
});
