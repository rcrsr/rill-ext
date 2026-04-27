/**
 * Tests for kv-file extension functions.
 *
 * Verifies all 11 operations, schema validation, persistence, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getStatus } from '@rcrsr/rill';
import { createFileKvExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

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
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.get.fn({ mount: 'default', key: 'missing' }, makeRuntimeCtx());
      expect(result).toBe('');
    });

    it('set() stores value and get() retrieves it', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' }, makeRuntimeCtx());
      const result = await ext.value.get.fn({ mount: 'default', key: 'k1' }, makeRuntimeCtx());
      expect(result).toBe('v1');
    });

    it('delete() removes key', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' }, makeRuntimeCtx());
      const deleted = await ext.value.delete.fn({ mount: 'default', key: 'k1' }, makeRuntimeCtx());
      expect(deleted).toBe(true);
      const result = await ext.value.get.fn({ mount: 'default', key: 'k1' }, makeRuntimeCtx());
      expect(result).toBe('');
    });

    it('delete() returns false for missing key', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.delete.fn({ mount: 'default', key: 'missing' }, makeRuntimeCtx());
      expect(result).toBe(false);
    });

    it('keys() returns all keys', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 }, makeRuntimeCtx());
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 }, makeRuntimeCtx());
      const result = await ext.value.keys.fn({ mount: 'default' }, makeRuntimeCtx());
      expect(result).toEqual(expect.arrayContaining(['a', 'b']));
      expect(result).toHaveLength(2);
    });

    it('has() checks key existence', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' }, makeRuntimeCtx());
      expect(await ext.value.has.fn({ mount: 'default', key: 'k1' }, makeRuntimeCtx())).toBe(true);
      expect(await ext.value.has.fn({ mount: 'default', key: 'missing' }, makeRuntimeCtx())).toBe(false);
    });

    it('clear() removes all keys', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 }, makeRuntimeCtx());
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 }, makeRuntimeCtx());
      await ext.value.clear.fn({ mount: 'default' }, makeRuntimeCtx());
      const keys = await ext.value.keys.fn({ mount: 'default' }, makeRuntimeCtx());
      expect(keys).toHaveLength(0);
    });

    it('getAll() returns all entries', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 }, makeRuntimeCtx());
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 'text' }, makeRuntimeCtx());
      const result = await ext.value.getAll.fn({ mount: 'default' }, makeRuntimeCtx());
      expect(result).toEqual({ a: 1, b: 'text' });
    });

    it('get_or() returns fallback for missing key', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.get_or.fn({
        mount: 'default',
        key: 'missing',
        fallback: 'default_val',
      }, makeRuntimeCtx());
      expect(result).toBe('default_val');
    });

    it('get_or() returns value when key exists', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'actual' }, makeRuntimeCtx());
      const result = await ext.value.get_or.fn({
        mount: 'default',
        key: 'k1',
        fallback: 'default_val',
      }, makeRuntimeCtx());
      expect(result).toBe('actual');
    });

    it('merge() shallow-merges into dict', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({
        mount: 'default',
        key: 'user',
        value: { name: 'Alice', age: 30 },
      }, makeRuntimeCtx());
      await ext.value.merge.fn({
        mount: 'default',
        key: 'user',
        partial: { age: 31, role: 'admin' },
      }, makeRuntimeCtx());
      const result = await ext.value.get.fn({ mount: 'default', key: 'user' }, makeRuntimeCtx());
      expect(result).toEqual({ name: 'Alice', age: 31, role: 'admin' });
    });

    it('returns invalid value when merge target is not a dict', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'string' }, makeRuntimeCtx());
      const result = await ext.value.merge.fn(
        { mount: 'default', key: 'k1', partial: { a: 1 } },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/Cannot merge into non-dict/);
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
      }, makeFactoryCtx());
      const count = await ext.value.get.fn({ mount: 'default', key: 'count' }, makeRuntimeCtx());
      expect(count).toBe(0);
      const name = await ext.value.get.fn({ mount: 'default', key: 'name' }, makeRuntimeCtx());
      expect(name).toBe('');
    });

    it('returns invalid value for undeclared key on get()', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      }, makeFactoryCtx());
      const result = await ext.value.get.fn(
        { mount: 'default', key: 'unknown' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/not declared in schema/);
    });

    it('returns invalid value for undeclared key on set()', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      }, makeFactoryCtx());
      const result = await ext.value.set.fn(
        { mount: 'default', key: 'unknown', value: 1 },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/not declared in schema/);
    });

    it('returns invalid value for type mismatch', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      }, makeFactoryCtx());
      const result = await ext.value.set.fn(
        { mount: 'default', key: 'count', value: 'not a number' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/expects number/);
    });

    it('clear() restores schema defaults', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        schema: { count: { type: 'number', default: 0 } },
      }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'count', value: 42 }, makeRuntimeCtx());
      await ext.value.clear.fn({ mount: 'default' }, makeRuntimeCtx());
      const result = await ext.value.get.fn({ mount: 'default', key: 'count' }, makeRuntimeCtx());
      expect(result).toBe(0);
    });
  });

  describe('mount operations', () => {
    it('returns invalid value for unknown mount', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.get.fn(
        { mount: 'nonexistent', key: 'k1' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/Mount 'nonexistent' not found/);
    });

    it('mounts() returns mount metadata', async () => {
      const ext = createFileKvExtension({
        mounts: {
          user: { mode: 'read-write', store: storePath },
        },
      }, makeFactoryCtx());
      const result = await ext.value.mounts.fn({}, makeRuntimeCtx());
      expect(result).toEqual([
        expect.objectContaining({ name: 'user', mode: 'read-write', schema: 'open' }),
      ]);
    });

    it('schema() returns empty for open mode', async () => {
      const ext = createFileKvExtension({
        mounts: { data: { mode: 'read-write', store: storePath } },
      }, makeFactoryCtx());
      const result = await ext.value.schema.fn({ mount: 'data' }, makeRuntimeCtx());
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
      }, makeFactoryCtx());
      const result = await ext.value.schema.fn({ mount: 'data' }, makeRuntimeCtx());
      expect(result).toEqual([{ key: 'count', type: 'number', description: 'Counter' }]);
    });
  });

  describe('read-only mode', () => {
    it('returns invalid value on set() in read-only mount', async () => {
      await fs.writeFile(storePath, JSON.stringify({ k: 'v' }));
      const ext = createFileKvExtension({
        mounts: { ro: { mode: 'read', store: storePath } },
      }, makeFactoryCtx());
      const result = await ext.value.set.fn(
        { mount: 'ro', key: 'k', value: 'new' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/read-only/);
    });
  });

  describe('persistence', () => {
    it('flushes to disk on dispose', async () => {
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'k1', value: 'v1' }, makeRuntimeCtx());
      await ext.dispose!();

      const content = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      expect(content).toEqual({ k1: 'v1' });
    });

    it('loads existing store on creation', async () => {
      await fs.writeFile(storePath, JSON.stringify({ existing: 'data' }));
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.get.fn({ mount: 'default', key: 'existing' }, makeRuntimeCtx());
      expect(result).toBe('data');
    });

    it('returns invalid value for corrupt store file', async () => {
      await fs.writeFile(storePath, 'not valid json{{{');
      const ext = createFileKvExtension({ store: storePath }, makeFactoryCtx());
      const result = await ext.value.get.fn(
        { mount: 'default', key: 'k1' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/state file corrupt/);
    });
  });

  describe('size limits', () => {
    it('returns invalid value when value exceeds maxValueSize', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        maxValueSize: 10,
      }, makeFactoryCtx());
      const result = await ext.value.set.fn(
        { mount: 'default', key: 'k1', value: 'a'.repeat(100) },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/exceeds size limit/);
    });

    it('returns invalid value when entry count exceeds maxEntries', async () => {
      const ext = createFileKvExtension({
        store: storePath,
        maxEntries: 2,
      }, makeFactoryCtx());
      await ext.value.set.fn({ mount: 'default', key: 'a', value: 1 }, makeRuntimeCtx());
      await ext.value.set.fn({ mount: 'default', key: 'b', value: 2 }, makeRuntimeCtx());
      const result = await ext.value.set.fn(
        { mount: 'default', key: 'c', value: 3 },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('R001');
      expect(status.message).toMatch(/exceeds entry limit/);
    });
  });
});
