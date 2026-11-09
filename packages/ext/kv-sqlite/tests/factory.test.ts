/**
 * Tests for SQLite kv extension factory.
 * Validates configuration, database initialization, WAL mode, and table creation.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RuntimeError } from '@rcrsr/rill';
import { createSqliteKvExtension } from '../src/factory.js';
import type { SqliteKvConfig } from '../src/types.js';
import { makeFactoryCtx } from './_setup.js';

// Test database directory
const TEST_DATA_DIR = join(process.cwd(), 'test-data');

// Clean up test databases after each test
afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('createSqliteKvExtension', () => {
  describe('configuration validation', () => {
    it('throws for missing mounts', () => {
      const config = {} as SqliteKvConfig;

      expect(() => createSqliteKvExtension(config, makeFactoryCtx())).toThrow(
        'at least one mount'
      );
    });

    it('throws for empty mounts object', () => {
      const config: SqliteKvConfig = {
        mounts: {},
      };

      expect(() => createSqliteKvExtension(config, makeFactoryCtx())).toThrow(
        'at least one mount'
      );
    });

    it('creates directory if database path parent does not exist', async () => {
      const dbPath = join(TEST_DATA_DIR, 'nested', 'dir', 'test.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      expect(existsSync(join(TEST_DATA_DIR, 'nested', 'dir'))).toBe(true);
      await ext.dispose?.();
    });

    it('throws RILL-R001 when a file blocks the database directory', () => {
      const blockerDir = join(TEST_DATA_DIR, 'blocker');
      mkdirSync(blockerDir, { recursive: true });

      // A regular file where a directory is expected makes SQLite fail to open
      const blockedPath = join(blockerDir, 'blocked');
      writeFileSync(blockedPath, '');

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: join(blockedPath, 'test.db'),
            table: 'kv_test',
          },
        },
      };

      let caught: unknown;
      try {
        createSqliteKvExtension(config, makeFactoryCtx());
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'Failed to initialize SQLite database for mount "test"'
      );
    });
  });

  describe('database initialization', () => {
    it('creates database file if not exists', async () => {
      const dbPath = join(TEST_DATA_DIR, 'new.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      expect(existsSync(dbPath)).toBe(true);
      await ext.dispose?.();
    });

    it('opens existing database file', async () => {
      const dbPath = join(TEST_DATA_DIR, 'existing.db');
      mkdirSync(TEST_DATA_DIR, { recursive: true });

      // Create database with existing data
      const db = new Database(dbPath);
      db.exec('CREATE TABLE existing (id INTEGER PRIMARY KEY)');
      db.close();

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Verify existing table still exists
      const verifyDb = new Database(dbPath, { readonly: true });
      const tables = verifyDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      verifyDb.close();

      expect(tableNames).toContain('existing');
      expect(tableNames).toContain('kv_test');

      await ext.dispose?.();
    });

    it('supports multiple mounts sharing same database', async () => {
      const dbPath = join(TEST_DATA_DIR, 'shared.db');
      const config: SqliteKvConfig = {
        mounts: {
          users: {
            mode: 'read-write',
            database: dbPath,
            table: 'users_kv',
          },
          settings: {
            mode: 'read-write',
            database: dbPath,
            table: 'settings_kv',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      // Verify both tables exist
      const db = new Database(dbPath, { readonly: true });
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      db.close();

      expect(tableNames).toContain('users_kv');
      expect(tableNames).toContain('settings_kv');

      await ext.dispose?.();
    });

    it('supports multiple mounts with different databases', async () => {
      const db1Path = join(TEST_DATA_DIR, 'db1.db');
      const db2Path = join(TEST_DATA_DIR, 'db2.db');
      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());

      expect(existsSync(db1Path)).toBe(true);
      expect(existsSync(db2Path)).toBe(true);

      await ext.dispose?.();
    });
  });

  describe('WAL mode', () => {
    it('enables WAL mode on database initialization', async () => {
      const dbPath = join(TEST_DATA_DIR, 'wal.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      await ext.dispose?.();

      // Verify WAL mode persists
      const db = new Database(dbPath, { readonly: true });
      const journalMode = db.pragma('journal_mode', { simple: true });
      db.close();

      expect(journalMode).toBe('wal');
    });
  });

  describe('table creation', () => {
    it('creates table with correct schema', async () => {
      const dbPath = join(TEST_DATA_DIR, 'schema.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      await ext.dispose?.();

      // Verify table schema
      const db = new Database(dbPath, { readonly: true });
      const columns = db.pragma('table_info(kv_test)') as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      db.close();

      expect(columns).toHaveLength(2);
      expect(columns[0]).toMatchObject({
        name: 'key',
        type: 'TEXT',
        pk: 1,
      });
      expect(columns[1]).toMatchObject({
        name: 'value',
        type: 'TEXT',
        notnull: 1,
      });
    });

    it('does not recreate existing table', async () => {
      const dbPath = join(TEST_DATA_DIR, 'existing-table.db');
      mkdirSync(TEST_DATA_DIR, { recursive: true });

      // Create database with existing table and data
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE kv_test (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      db.prepare('INSERT INTO kv_test (key, value) VALUES (?, ?)').run(
        'existing_key',
        '"existing_value"'
      );
      db.close();

      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      await ext.dispose?.();

      // Verify existing data preserved
      const verifyDb = new Database(dbPath, { readonly: true });
      const row = verifyDb
        .prepare('SELECT * FROM kv_test WHERE key = ?')
        .get('existing_key') as { key: string; value: string } | undefined;
      verifyDb.close();

      expect(row).toBeDefined();
      expect(row?.value).toBe('"existing_value"');
    });
  });

  describe('dispose lifecycle', () => {
    it('closes the database connection once on dispose', async () => {
      const dbPath = join(TEST_DATA_DIR, 'dispose.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };
      const closeSpy = vi.spyOn(Database.prototype, 'close');

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      expect(closeSpy).not.toHaveBeenCalled();
      await ext.dispose?.();

      expect(closeSpy).toHaveBeenCalledOnce();
      // Should be able to open database again (not locked)
      const db = new Database(dbPath);
      expect(db.open).toBe(true);
      db.close();
    });

    it('closes each mount database exactly once on dispose', async () => {
      const db1Path = join(TEST_DATA_DIR, 'dispose1.db');
      const db2Path = join(TEST_DATA_DIR, 'dispose2.db');
      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };
      const closeSpy = vi.spyOn(Database.prototype, 'close');

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      await ext.dispose?.();

      expect(closeSpy).toHaveBeenCalledTimes(2);
      expect(new Set(closeSpy.mock.contexts).size).toBe(2);
    });

    it('closes databases only once when disposed twice', async () => {
      const dbPath = join(TEST_DATA_DIR, 'double-dispose.db');
      const config: SqliteKvConfig = {
        mounts: {
          test: {
            mode: 'read-write',
            database: dbPath,
            table: 'kv_test',
          },
        },
      };
      const closeSpy = vi.spyOn(Database.prototype, 'close');

      const ext = createSqliteKvExtension(config, makeFactoryCtx());
      await ext.dispose?.();
      await ext.dispose?.();

      expect(closeSpy).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('closes opened databases and throws when a later mount fails', () => {
      const db1Path = join(TEST_DATA_DIR, 'cleanup1.db');
      const db2Path = join(TEST_DATA_DIR, 'cleanup2.db');

      // Make db2Path a directory so opening it as a database fails
      mkdirSync(TEST_DATA_DIR, { recursive: true });
      mkdirSync(db2Path);

      const config: SqliteKvConfig = {
        mounts: {
          mount1: {
            mode: 'read-write',
            database: db1Path,
            table: 'kv_data',
          },
          mount2: {
            mode: 'read-write',
            database: db2Path,
            table: 'kv_data',
          },
        },
      };
      const closeSpy = vi.spyOn(Database.prototype, 'close');

      expect(() => createSqliteKvExtension(config, makeFactoryCtx())).toThrow(
        /Failed to initialize SQLite database for mount "mount2"/
      );

      // Only the first mount's database was opened; it must be closed once
      expect(closeSpy).toHaveBeenCalledOnce();
    });
  });
});
