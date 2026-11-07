import { describe, it, expect } from 'vitest';
import { createChromaExtension } from '../src/factory.js';

describe('createChromaExtension', () => {
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
  });

  describe('disposal', () => {
    it('dispose is idempotent', async () => {
      const ext = createChromaExtension({ collection: 'test_collection' });

      // Multiple calls should not throw
      await expect(ext.dispose!()).resolves.toBeUndefined();
      await expect(ext.dispose!()).resolves.toBeUndefined();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    // Note: Testing post-dispose error behavior (EC-8) requires a full
    // RuntimeContext which is out of scope for unit tests.
    // Integration tests in task 3.5 will cover this scenario.
  });
});
