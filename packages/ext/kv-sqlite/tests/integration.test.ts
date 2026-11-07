/**
 * Integration tests for SQLite kv contract functions.
 * Tests multi-connection access, mount errors, read-only enforcement, and size limits.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isInvalid, getStatus, type RillValue } from '@rcrsr/rill';
import { createSqliteKvExtension } from '../src/factory.js';
import type { SqliteKvConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

/**
 * Extract a named callable from an ExtensionFactoryResult value dict.
 * Auto-injects a runtime context and converts invalid RillValue results to
 * thrown Errors so existing `.rejects.toThrow(...)` patterns continue to work.
 */
function getCallable(
  ext: { value: unknown },
  name: string
): { fn: (args: Record<string, unknown>) => unknown } {
  const value = ext.value as Record<
    string,
    { fn: (args: Record<string, unknown>, ctx: unknown) => unknown }
  >;
  const callable = value[name]!;
  const checkInvalid = (r: unknown): unknown => {
    if (isInvalid(r as RillValue)) {
      throw new Error(getStatus(r as RillValue).message);
    }
    return r;
  };
  return {
    fn: (args: Record<string, unknown>) => {
      const result = callable.fn(args, makeRuntimeCtx());
      if (
        result &&
        typeof result === 'object' &&
        'then' in (result as object)
      ) {
        return (result as Promise<unknown>).then(checkInvalid);
      }
      return checkInvalid(result);
    },
  };
}

// Test database directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data-integration');

// Clean up test databases before and after each test
beforeEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

afterEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('Integration Tests', () => {
  describe('multiple connections to one database file', () => {
    it('reads the same value through 10 separately opened connections', () => {
      const dbPath = join(TEST_DATA_DIR, 'multi-reads.db');
      const config: SqliteKvConfig = {
        mounts: {
          state: {
            mode: 'read-write',
            database: dbPath,
            table: 'state_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      getCallable(ext, 'set').fn({
        mount: 'state',
        key: 'data',
        value: 'test-value',
      });
      ext.dispose?.();

      const results = Array.from({ length: 10 }, () => {
        const reader = createSqliteKvExtension(config, makeFactoryCtx());
        const value = getCallable(reader, 'get').fn({
          mount: 'state',
          key: 'data',
        });
        reader.dispose?.();
        return value;
      });

      expect(results).toEqual(Array.from({ length: 10 }, () => 'test-value'));
    });
  });

  describe('Unknown Mount Name', () => {
    it('throws error with mount name for all kv functions', () => {
      const dbPath = join(TEST_DATA_DIR, 'unknown-mount.db');
      const config: SqliteKvConfig = {
        mounts: {
          state: {
            mode: 'read-write',
            database: dbPath,
            table: 'state_kv',
          },
          cache: {
            mode: 'read-write',
            database: dbPath,
            table: 'cache_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Test all functions throw for unknown mount
      expect(() =>
        getCallable(ext, 'get').fn({ mount: 'unknown', key: 'key' })
      ).toThrow('not found');
      expect(() =>
        getCallable(ext, 'get_or').fn({
          mount: 'unknown',
          key: 'key',
          fallback: 'fallback',
        })
      ).toThrow('not found');
      expect(() =>
        getCallable(ext, 'set').fn({
          mount: 'unknown',
          key: 'key',
          value: 'value',
        })
      ).toThrow('not found');
      expect(() =>
        getCallable(ext, 'merge').fn({
          mount: 'unknown',
          key: 'key',
          partial: { a: 1 },
        })
      ).toThrow('not found');
      expect(() =>
        getCallable(ext, 'delete').fn({ mount: 'unknown', key: 'key' })
      ).toThrow('not found');
      expect(() => getCallable(ext, 'keys').fn({ mount: 'unknown' })).toThrow(
        'not found'
      );
      expect(() =>
        getCallable(ext, 'has').fn({ mount: 'unknown', key: 'key' })
      ).toThrow('not found');
      expect(() => getCallable(ext, 'clear').fn({ mount: 'unknown' })).toThrow(
        'not found'
      );
      expect(() => getCallable(ext, 'getAll').fn({ mount: 'unknown' })).toThrow(
        'not found'
      );
      expect(() => getCallable(ext, 'schema').fn({ mount: 'unknown' })).toThrow(
        'not found'
      );

      ext.dispose?.();
    });

    it('includes available mounts in error message', () => {
      const dbPath = join(TEST_DATA_DIR, 'mount-list.db');
      const config: SqliteKvConfig = {
        mounts: {
          state: {
            mode: 'read-write',
            database: dbPath,
            table: 'state_kv',
          },
          cache: {
            mode: 'read-write',
            database: dbPath,
            table: 'cache_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      try {
        getCallable(ext, 'get').fn({ mount: 'unknown', key: 'key' });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('state');
        expect(message).toContain('cache');
      }

      ext.dispose?.();
    });
  });

  describe('Read-Only Mode Enforcement', () => {
    it('throws PermissionError for write operations on read-only mount', () => {
      const dbPath = join(TEST_DATA_DIR, 'readonly.db');
      const config: SqliteKvConfig = {
        mounts: {
          'readonly-mount': {
            mode: 'read',
            database: dbPath,
            table: 'readonly_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Test all write operations throw
      expect(() =>
        getCallable(ext, 'set').fn({
          mount: 'readonly-mount',
          key: 'key',
          value: 'value',
        })
      ).toThrow('read-only');
      expect(() =>
        getCallable(ext, 'merge').fn({
          mount: 'readonly-mount',
          key: 'key',
          partial: { a: 1 },
        })
      ).toThrow('read-only');
      expect(() =>
        getCallable(ext, 'delete').fn({ mount: 'readonly-mount', key: 'key' })
      ).toThrow('read-only');
      expect(() =>
        getCallable(ext, 'clear').fn({ mount: 'readonly-mount' })
      ).toThrow('read-only');

      ext.dispose?.();
    });

    it('allows read operations on read-only mount', () => {
      const dbPath = join(TEST_DATA_DIR, 'readonly-reads.db');

      // Setup: create database with write mode first
      const writeConfig: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'readonly_kv',
          },
        },
      };

      const writer = createSqliteKvExtension(writeConfig, makeFactoryCtx());
      getCallable(writer, 'set').fn({
        mount: 'test',
        key: 'name',
        value: 'Alice',
      });
      writer.dispose?.();

      // Open as read-only
      const readConfig: SqliteKvConfig = {
        mounts: {
          'readonly-mount': {
            mode: 'read',
            database: dbPath,
            table: 'readonly_kv',
          },
        },
      };

      const reader = createSqliteKvExtension(readConfig, makeFactoryCtx());

      // Read operations should succeed
      expect(
        getCallable(reader, 'get').fn({ mount: 'readonly-mount', key: 'name' })
      ).toBe('Alice');
      expect(
        getCallable(reader, 'has').fn({ mount: 'readonly-mount', key: 'name' })
      ).toBe(true);
      expect(
        getCallable(reader, 'keys').fn({ mount: 'readonly-mount' })
      ).toEqual(['name']);
      expect(
        getCallable(reader, 'getAll').fn({ mount: 'readonly-mount' })
      ).toEqual({ name: 'Alice' });

      reader.dispose?.();
    });
  });

  describe('Maximum Value Size Boundary', () => {
    it('succeeds when value is exactly at size limit', () => {
      const dbPath = join(TEST_DATA_DIR, 'size-exact.db');
      const sizeLimit = 102400; // 100KB
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'size_kv',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Create string that JSON-encodes to exactly 102400 bytes
      // JSON string adds 2 bytes for quotes, so we need 102398 characters
      const targetSize = sizeLimit - 2; // Account for JSON quotes
      const value = 'x'.repeat(targetSize);

      // Verify size calculation
      const jsonEncoded = JSON.stringify(value);
      const actualSize = Buffer.byteLength(jsonEncoded, 'utf-8');
      expect(actualSize).toBe(sizeLimit);

      // Should succeed
      expect(() =>
        getCallable(ext, 'set').fn({ mount: 'test', key: 'key', value })
      ).not.toThrow();

      ext.dispose?.();
    });

    it('throws SizeError when value exceeds limit by 1 byte', () => {
      const dbPath = join(TEST_DATA_DIR, 'size-over.db');
      const sizeLimit = 102400; // 100KB
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'size_kv',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Create string that JSON-encodes to 102401 bytes (1 byte over)
      const targetSize = sizeLimit - 1; // Account for JSON quotes, add 1 extra
      const value = 'x'.repeat(targetSize);

      // Verify size calculation
      const jsonEncoded = JSON.stringify(value);
      const actualSize = Buffer.byteLength(jsonEncoded, 'utf-8');
      expect(actualSize).toBe(sizeLimit + 1);

      // Should throw
      expect(() =>
        getCallable(ext, 'set').fn({ mount: 'test', key: 'key', value })
      ).toThrow('exceeds size limit');

      ext.dispose?.();
    });

    it('validates size for complex objects', () => {
      const dbPath = join(TEST_DATA_DIR, 'size-object.db');
      const sizeLimit = 1000;
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'size_kv',
            maxValueSize: sizeLimit,
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Create object that exceeds size limit
      const largeObject = {
        data: 'x'.repeat(1000),
        nested: { items: Array.from({ length: 100 }, (_, i) => i) },
      };

      expect(() =>
        getCallable(ext, 'set').fn({
          mount: 'test',
          key: 'key',
          value: largeObject,
        })
      ).toThrow('exceeds size limit');

      ext.dispose?.();
    });
  });

  describe('sequential writes through separate connections', () => {
    it('keeps the last written value after 5 writes to the same key', () => {
      const dbPath = join(TEST_DATA_DIR, 'sequential-writes.db');
      const config: SqliteKvConfig = {
        mounts: {
          shared: {
            mode: 'read-write',
            database: dbPath,
            table: 'shared_kv',
          },
        },
      };

      for (let index = 0; index < 5; index++) {
        const writer = createSqliteKvExtension(config, makeFactoryCtx());
        getCallable(writer, 'set').fn({
          mount: 'shared',
          key: 'counter',
          value: index,
        });
        writer.dispose?.();
      }

      const reader = createSqliteKvExtension(config, makeFactoryCtx());
      expect(
        getCallable(reader, 'get').fn({ mount: 'shared', key: 'counter' })
      ).toBe(4);
      expect(getCallable(reader, 'keys').fn({ mount: 'shared' })).toEqual([
        'counter',
      ]);

      reader.dispose?.();
    });

    it('persists writes to 5 different keys', () => {
      const dbPath = join(TEST_DATA_DIR, 'sequential-different-keys.db');
      const config: SqliteKvConfig = {
        mounts: {
          shared: {
            mode: 'read-write',
            database: dbPath,
            table: 'shared_kv',
          },
        },
      };

      for (let index = 0; index < 5; index++) {
        const writer = createSqliteKvExtension(config, makeFactoryCtx());
        getCallable(writer, 'set').fn({
          mount: 'shared',
          key: `key-${index}`,
          value: `value-${index}`,
        });
        writer.dispose?.();
      }

      const reader = createSqliteKvExtension(config, makeFactoryCtx());
      const keys = getCallable(reader, 'keys').fn({ mount: 'shared' });

      expect(keys).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(keys).toContain(`key-${i}`);
        expect(
          getCallable(reader, 'get').fn({ mount: 'shared', key: `key-${i}` })
        ).toBe(`value-${i}`);
      }

      reader.dispose?.();
    });
  });

  describe('Merge Error Contracts', () => {
    it.each([
      { type: 'string', key: 'name', value: 'Alice', partial: { age: 30 } },
      { type: 'number', key: 'count', value: 42, partial: { increment: 1 } },
      { type: 'list', key: 'items', value: [1, 2, 3], partial: { extra: 4 } },
    ])(
      'throws when merging into $type value',
      ({ type, key, value, partial }) => {
        const dbPath = join(TEST_DATA_DIR, `merge-${type}.db`);
        const config: SqliteKvConfig = {
          mounts: {
            test: {
              mode: 'read-write',
              database: dbPath,
              table: 'merge_kv',
            },
          },
        };

        const ext = createSqliteKvExtension(config, makeFactoryCtx());

        getCallable(ext, 'set').fn({ mount: 'test', key, value });

        expect(() =>
          getCallable(ext, 'merge').fn({ mount: 'test', key, partial })
        ).toThrow('non-dict');

        ext.dispose?.();
      }
    );
  });
});
