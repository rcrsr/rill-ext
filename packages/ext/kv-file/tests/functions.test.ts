/**
 * Tests for kv-file extension functions.
 *
 * Verifies all 11 operations, schema validation, persistence, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuntimeError } from '@rcrsr/rill';
import { createFileKvExtension } from '../src/factory.js';

describe('kv-file functions', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-kv-file-test-'));
    storePath = path.join(tempDir, 'test-store.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('open mode (no schema)', () => {
    it('get() returns empty string for missing key', async () => {
      const ext = createFileKvExtension({ store: storePath });
      const result = await ext.value.get.fn({ mount: 'default', key: 'missing' });
      expect(result).toBe('');
    });

    it('set() stores value and get() retrieves it', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' });
      const result = await ext.value.get.fn({ mount: 'default', key: 'k1' });
      expect(result).toBe('v1');
    });

    it('delete() removes key', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' });
      const deleted = await ext.value.delete.fn({ mount: 'default', key: 'k1' });
      expect(deleted).toBe(true);
      const result = await ext.value.get.fn({ mount: 'default', key: 'k1' });
      expect(result).toBe('');
    });

    it('delete() returns false for missing key', async () => {
      const ext = createFileKvExtension({ store: storePath });
      const result = await ext.value.delete.fn({ mount: 'default', key: 'missing' });
      expect(result).toBe(false);
    });

    it('keys() returns all keys', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 });
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 });
      const result = await ext.value.keys.fn({ mount: 'default' });
      expect(result).toEqual(expect.arrayContaining(['a', 'b']));
      expect(result).toHaveLength(2);
    });

    it('has() checks key existence', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' });
      expect(await ext.value.has.fn({ mount: 'default', key: 'k1' })).toBe(true);
      expect(await ext.value.has.fn({ mount: 'default', key: 'missing' })).toBe(false);
    });

    it('clear() removes all keys', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 });
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 });
      await ext.value.clear.fn({ mount: 'default' });
      const keys = await ext.value.keys.fn({ mount: 'default' });
      expect(keys).toHaveLength(0);
    });

    it('getAll() returns all entries', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 });
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 'text' });
      const result = await ext.value.getAll.fn({ mount: 'default' });
      expect(result).toEqual({ a: 1, b: 'text' });
    });

    it('get_or() returns fallback for missing key', async () => {
      const ext = createFileKvExtension({ store: storePath });
      const result = await ext.value.get_or.fn({
        mount: 'default',
        key: 'missing',
        fallback: 'default_val',
      });
      expect(result).toBe('default_val');
    });

    it('get_or() returns value when key exists', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'actual' });
      const result = await ext.value.get_or.fn({
        mount: 'default',
        key: 'k1',
        fallback: 'default_val',
      });
      expect(result).toBe('actual');
    });

    it('merge() shallow-merges into dict', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({
        mount: 'default',
        key: 'user',
        value: { name: 'Alice', age: 30 },
      });
      await ext.value.merge.fn({
        mount: 'default',
        key: 'user',
        partial: { age: 31, role: 'admin' },
      });
      const result = await ext.value.get.fn({ mount: 'default', key: 'user' });
      expect(result).toEqual({ name: 'Alice', age: 31, role: 'admin' });
    });

    it('merge() throws when existing value is not a dict', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'string' });
      await expect(
        ext.value.merge.fn({ mount: 'default', key: 'k1', partial: { a: 1 } }),
      ).rejects.toThrow(RuntimeError);
    });
  });

  describe('declared mode (with schema)', () => {
    it('initializes with schema defaults', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: {
          count: { type: 'number', default: 0 },
          name: { type: 'string', default: '' },
        },
      });
      const count = await ext.value.get.fn({ mount: 'default', key: 'count' });
      expect(count).toBe(0);
      const name = await ext.value.get.fn({ mount: 'default', key: 'name' });
      expect(name).toBe('');
    });

    it('throws for undeclared key on get()', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      });
      await expect(
        ext.value.get.fn({ mount: 'default', key: 'unknown' }),
      ).rejects.toThrow('not declared in schema');
    });

    it('throws for undeclared key on set()', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      });
      await expect(
        ext.value.set.fn({ mount: 'default', key: 'unknown', value: 1 }),
      ).rejects.toThrow('not declared in schema');
    });

    it('throws for type mismatch', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      });
      await expect(
        ext.value.set.fn({ mount: 'default', key: 'count', value: 'not a number' }),
      ).rejects.toThrow('expects number');
    });

    it('clear() restores schema defaults', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      });
      await ext.value.set.fn({ mount: 'default', key: 'count', value: 42 });
      await ext.value.clear.fn({ mount: 'default' });
      const result = await ext.value.get.fn({ mount: 'default', key: 'count' });
      expect(result).toBe(0);
    });
  });

  describe('mount operations', () => {
    it('throws for unknown mount', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await expect(
        ext.value.get.fn({ mount: 'nonexistent', key: 'k1' }),
      ).rejects.toThrow("Mount 'nonexistent' not found");
    });

    it('mounts() returns mount metadata', async () => {
      const ext = createFileKvExtension({
        mounts: {
          user: { mode: 'read-write', store: storePath },
        },
      });
      const result = await ext.value.mounts.fn({});
      expect(result).toEqual([
        expect.objectContaining({ name: 'user', mode: 'read-write', schema: 'open' }),
      ]);
    });

    it('schema() returns empty for open mode', async () => {
      const ext = createFileKvExtension({
        mounts: { data: { mode: 'read-write', store: storePath } },
      });
      const result = await ext.value.schema.fn({ mount: 'data' });
      expect(result).toEqual([]);
    });

    it('schema() returns entries for declared mode', async () => {
      const ext = createFileKvExtension({
        mounts: {
          data: {
            mode: 'read-write',
            store: storePath,
            schema: {
              count: { type: 'number', default: 0, description: 'Counter' },
            },
          },
        },
      });
      const result = await ext.value.schema.fn({ mount: 'data' });
      expect(result).toEqual([{ key: 'count', type: 'number', description: 'Counter' }]);
    });
  });

  describe('read-only mode', () => {
    it('throws on set() in read-only mount', async () => {
      await fs.writeFile(storePath, JSON.stringify({ k: 'v' }));
      const ext = createFileKvExtension({
        mounts: { ro: { mode: 'read', store: storePath } },
      });
      await expect(
        ext.value.set.fn({ mount: 'ro', key: 'k', value: 'new' }),
      ).rejects.toThrow('read-only');
    });
  });

  describe('persistence', () => {
    it('flushes to disk on dispose', async () => {
      const ext = createFileKvExtension({ store: storePath });
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' });
      await ext.dispose!();

      const content = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      expect(content).toEqual({ k1: 'v1' });
    });

    it('loads existing store on creation', async () => {
      await fs.writeFile(storePath, JSON.stringify({ existing: 'data' }));
      const ext = createFileKvExtension({ store: storePath });
      const result = await ext.value.get.fn({ mount: 'default', key: 'existing' });
      expect(result).toBe('data');
    });

    it('throws for corrupt store file', async () => {
      await fs.writeFile(storePath, 'not valid json{{{');
      const ext = createFileKvExtension({ store: storePath });
      await expect(
        ext.value.get.fn({ mount: 'default', key: 'k1' }),
      ).rejects.toThrow('state file corrupt');
    });
  });

  describe('size limits', () => {
    it('throws when value exceeds maxValueSize', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        maxValueSize: 10,
      });
      await expect(
        ext.value.set.fn({ mount: 'default', key: 'k1', value: 'a'.repeat(100) }),
      ).rejects.toThrow('exceeds size limit');
    });

    it('throws when entry count exceeds maxEntries', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        maxEntries: 2,
      });
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 });
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 });
      await expect(
        ext.value.set.fn({ mount: 'default', key: 'c', value: 3 }),
      ).rejects.toThrow('exceeds entry limit');
    });
  });
});
