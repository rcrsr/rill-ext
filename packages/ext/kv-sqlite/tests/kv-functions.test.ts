/**
 * Tests for SQLite kv extension functions.
 * Covers sqlite-specific behavior not in the shared contract suite.
 */

import { describe, it, expect, afterEach } from 'vitest';
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
      if (typeof result === 'object' && result !== null && 'then' in result) {
        return (result as Promise<unknown>).then(checkInvalid);
      }
      return checkInvalid(result);
    },
  };
}

// Test database directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data-functions');

// Clean up test databases after each test
afterEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('kv functions', () => {
  describe('set()', () => {
    it('validates type in declared mode', async () => {
      const dbPath = join(TEST_DATA_DIR, 'set-type.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
            schema: {
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      expect(() =>
        getCallable(ext, 'set').fn({
          mount: 'test',
          key: 'count',
          value: 'not-a-number',
        })
      ).toThrow('expects number');
      await ext.dispose?.();
    });
  });

  describe('mounts()', () => {
    it('returns list of mount metadata', async () => {
      const db1Path = join(TEST_DATA_DIR, 'mounts1.db');
      const db2Path = join(TEST_DATA_DIR, 'mounts2.db');
      const config: SqliteKvConfig = {
        mounts: {
          users: {
            mode: 'read-write',
            database: db1Path,
            table: 'users_kv',
            schema: {
              name: { type: 'string', default: '' },
            },
            maxEntries: 5000,
            maxValueSize: 50000,
          },
          cache: {
            mode: 'read',
            database: db2Path,
            table: 'cache_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      const result = getCallable(ext, 'mounts').fn({});

      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        name: 'users',
        mode: 'read-write',
        schema: 'declared',
        max_entries: 5000,
        max_value_size: 50000,
        database: db1Path,
        table: 'users_kv',
      });
      expect(result).toContainEqual({
        name: 'cache',
        mode: 'read',
        schema: 'open',
        max_entries: 10000,
        max_value_size: 102400,
        database: db2Path,
        table: 'cache_kv',
      });

      await ext.dispose?.();
    });
  });
});
