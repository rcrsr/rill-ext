/**
 * Extension factory for SQLite kv storage backend.
 * Creates extension instance with config validation and database lifecycle management.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  RuntimeError,
  anyTypeValue,
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import {
  mapKvError,
  type KvExtensionContract,
} from '@rcrsr/rill-ext-kv-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { SqliteKvConfig, SqliteKvMountConfig } from './types.js';

const PROVIDER = 'kv-sqlite';

interface MountDatabase {
  db: Database.Database;
  table: string;
}

/**
 * Create SQLite kv extension instance.
 */
export function createSqliteKvExtension(
  config: SqliteKvConfig,
  ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new RuntimeError(
      'RILL-R005',
      'SQLite kv extension requires at least one mount in configuration'
    );
  }

  const databases = new Map<string, MountDatabase>();

  for (const [mountName, mountConfig] of Object.entries(config.mounts)) {
    try {
      const dbPath = mountConfig.database;
      const dbDir = dirname(dbPath);

      if (!existsSync(dbDir)) {
        try {
          mkdirSync(dbDir, { recursive: true });
        } catch (error: unknown) {
          throw new RuntimeError(
            'RILL-R005',
            `Failed to create directory for database path "${dbPath}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');

      const tableName = mountConfig.table;
      const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!TABLE_NAME_PATTERN.test(tableName)) {
        throw new RuntimeError(
          'RILL-R005',
          `Invalid table name "${tableName}": must match pattern ${TABLE_NAME_PATTERN}`
        );
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      databases.set(mountName, { db, table: tableName });
    } catch (error: unknown) {
      for (const { db } of databases.values()) {
        db.close();
      }
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError(
        'RILL-R005',
        `Failed to initialize SQLite database for mount "${mountName}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const { db } of databases.values()) {
      try {
        db.close();
      } catch {
        // ignore close errors
      }
    }
    databases.clear();
  };

  if (ctx?.signal) {
    if (ctx.signal.aborted) {
      dispose();
    } else {
      ctx.signal.addEventListener('abort', () => dispose(), { once: true });
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function getMountDb(mountName: string): {
    mountDb: MountDatabase;
    mountConfig: SqliteKvMountConfig;
  } | null {
    const mountDb = databases.get(mountName);
    const mountConfig = config.mounts[mountName];
    if (!mountDb || !mountConfig) return null;
    return { mountDb, mountConfig };
  }

  function calculateValueSize(value: RillValue): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }

  function actualTypeOf(value: RillValue): string {
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'bool';
    if (Array.isArray(value)) return 'list';
    if (typeof value === 'object' && value !== null) return 'dict';
    return typeof value;
  }

  function isDictValue(value: RillValue): value is Record<string, RillValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function unknownMount(runCtx: RuntimeContext, mountName: string): RillValue {
    const available = Object.keys(config.mounts);
    return runCtx.invalidate(
      new Error(
        `Mount '${mountName}' not found. Available mounts: ${available.join(', ')}`
      ),
      {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: {
          kind: 'unknown_mount',
          mountName,
          availableMounts: available,
        },
      }
    );
  }

  function readonlyMount(
    runCtx: RuntimeContext,
    mountName: string,
    mode: string
  ): RillValue {
    return runCtx.invalidate(
      new Error(`Mount '${mountName}' is read-only (mode: ${mode})`),
      {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'readonly_mount', mountName, mode },
      }
    );
  }

  function disposedInvalid(runCtx: RuntimeContext): RillValue {
    return runCtx.invalidate(new Error('SQLite kv extension disposed'), {
      code: 'DISPOSED',
      provider: PROVIDER,
      raw: { kind: 'extension_disposed' },
    });
  }

  // ============================================================
  // KV FUNCTIONS
  // ============================================================

  const get: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountDb, mountConfig } = mount;

    if (mountConfig.schema && !(key in mountConfig.schema)) {
      return runCtx.invalidate(
        new Error(`key "${key}" not declared in schema`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'schema_violation', mount: mountName, key },
        }
      );
    }

    try {
      const stmt = mountDb.db.prepare(
        `SELECT value FROM ${mountDb.table} WHERE key = ?`
      );
      const row = stmt.get(key) as { value: string } | undefined;
      if (row) return JSON.parse(row.value) as RillValue;
      if (mountConfig.schema && key in mountConfig.schema) {
        return mountConfig.schema[key]!.default;
      }
      return '';
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const get_or: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const fallback = args['fallback'] as RillValue;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);

    try {
      const stmt = mount.mountDb.db.prepare(
        `SELECT value FROM ${mount.mountDb.table} WHERE key = ?`
      );
      const row = stmt.get(key) as { value: string } | undefined;
      if (row) return JSON.parse(row.value) as RillValue;
      return fallback;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const set: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const value = args['value'] as RillValue;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountDb, mountConfig } = mount;

    if (mountConfig.mode === 'read')
      return readonlyMount(runCtx, mountName, mountConfig.mode);

    if (mountConfig.schema && !(key in mountConfig.schema)) {
      return runCtx.invalidate(
        new Error(`key "${key}" not declared in schema`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'schema_violation', mount: mountName, key },
        }
      );
    }

    if (mountConfig.schema && key in mountConfig.schema) {
      const expected = mountConfig.schema[key]!.type;
      const actual = actualTypeOf(value);
      if (actual !== expected) {
        return runCtx.invalidate(
          new Error(`key "${key}" expects ${expected}, got ${actual}`),
          {
            code: 'TYPE_MISMATCH',
            provider: PROVIDER,
            raw: { kind: 'type_mismatch', key, expected, actual },
          }
        );
      }
    }

    const maxValueSize = mountConfig.maxValueSize ?? 102400;
    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      return runCtx.invalidate(
        new Error(
          `value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`
        ),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'value_too_large', key, valueSize, maxValueSize },
        }
      );
    }

    try {
      const maxEntries = mountConfig.maxEntries ?? 10000;
      const hasStmt = mountDb.db.prepare(
        `SELECT 1 FROM ${mountDb.table} WHERE key = ?`
      );
      const exists = hasStmt.get(key) !== undefined;

      if (!exists) {
        const countStmt = mountDb.db.prepare(
          `SELECT COUNT(*) as count FROM ${mountDb.table}`
        );
        const countRow = countStmt.get() as { count: number };
        if (countRow.count >= maxEntries) {
          return runCtx.invalidate(
            new Error(
              `store exceeds entry limit (${countRow.count + 1} > ${maxEntries})`
            ),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: {
                kind: 'entry_limit_exceeded',
                count: countRow.count + 1,
                maxEntries,
              },
            }
          );
        }
      }

      const stmt = mountDb.db.prepare(
        `INSERT OR REPLACE INTO ${mountDb.table} (key, value) VALUES (?, ?)`
      );
      stmt.run(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const merge: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const partial = args['partial'] as Record<string, RillValue>;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountDb, mountConfig } = mount;

    if (mountConfig.mode === 'read')
      return readonlyMount(runCtx, mountName, mountConfig.mode);

    let invalidResult: RillValue | null = null;

    try {
      const mergeTransaction = mountDb.db.transaction(() => {
        const selectStmt = mountDb.db.prepare(
          `SELECT value FROM ${mountDb.table} WHERE key = ?`
        );
        const row = selectStmt.get(key) as { value: string } | undefined;

        let currentValue: RillValue | undefined;
        if (row) {
          currentValue = JSON.parse(row.value) as RillValue;
          if (!isDictValue(currentValue)) {
            invalidResult = runCtx.invalidate(
              new Error(`Cannot merge into non-dict value at key "${key}"`),
              {
                code: 'INVALID_INPUT',
                provider: PROVIDER,
                raw: {
                  kind: 'merge_non_dict',
                  key,
                  currentType: typeof currentValue,
                },
              }
            );
            throw new Error('__merge_invalid__');
          }
        }

        const mergedValue = {
          ...(currentValue as Record<string, RillValue> | undefined),
          ...partial,
        };

        if (mountConfig.schema && key in mountConfig.schema) {
          const expected = mountConfig.schema[key]!.type;
          const actual = actualTypeOf(mergedValue);
          if (actual !== expected) {
            invalidResult = runCtx.invalidate(
              new Error(`key "${key}" expects ${expected}, got ${actual}`),
              {
                code: 'TYPE_MISMATCH',
                provider: PROVIDER,
                raw: { kind: 'type_mismatch', key, expected, actual },
              }
            );
            throw new Error('__merge_invalid__');
          }
        }

        const maxValueSize = mountConfig.maxValueSize ?? 102400;
        const valueSize = calculateValueSize(mergedValue);
        if (valueSize > maxValueSize) {
          invalidResult = runCtx.invalidate(
            new Error(
              `merged value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`
            ),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'value_too_large', key, valueSize, maxValueSize },
            }
          );
          throw new Error('__merge_invalid__');
        }

        const updateStmt = mountDb.db.prepare(
          `INSERT OR REPLACE INTO ${mountDb.table} (key, value) VALUES (?, ?)`
        );
        updateStmt.run(key, JSON.stringify(mergedValue));
      });

      mergeTransaction();
      return true;
    } catch (error) {
      if (invalidResult !== null) return invalidResult;
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const deleteKey: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountDb, mountConfig } = mount;

    if (mountConfig.mode === 'read')
      return readonlyMount(runCtx, mountName, mountConfig.mode);

    try {
      const stmt = mountDb.db.prepare(
        `DELETE FROM ${mountDb.table} WHERE key = ?`
      );
      const result = stmt.run(key);
      return result.changes > 0;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const keys: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);

    try {
      const stmt = mount.mountDb.db.prepare(
        `SELECT key FROM ${mount.mountDb.table}`
      );
      const rows = stmt.all() as { key: string }[];
      return rows.map((row) => row.key);
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const has: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);

    try {
      const stmt = mount.mountDb.db.prepare(
        `SELECT 1 FROM ${mount.mountDb.table} WHERE key = ?`
      );
      const row = stmt.get(key);
      return row !== undefined;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const clear: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountDb, mountConfig } = mount;

    if (mountConfig.mode === 'read')
      return readonlyMount(runCtx, mountName, mountConfig.mode);

    try {
      const deleteStmt = mountDb.db.prepare(`DELETE FROM ${mountDb.table}`);
      deleteStmt.run();

      if (mountConfig.schema) {
        const insertStmt = mountDb.db.prepare(
          `INSERT INTO ${mountDb.table} (key, value) VALUES (?, ?)`
        );
        for (const [k, entry] of Object.entries(mountConfig.schema)) {
          insertStmt.run(k, JSON.stringify(entry.default));
        }
      }
      return true;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const getAll: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);

    try {
      const stmt = mount.mountDb.db.prepare(
        `SELECT key, value FROM ${mount.mountDb.table}`
      );
      const rows = stmt.all() as { key: string; value: string }[];
      const result: Record<string, RillValue> = {};
      for (const row of rows) {
        result[row.key] = JSON.parse(row.value) as RillValue;
      }
      return result;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const schema: CallableFn = (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    const mountName = args['mount'] as string;
    const mount = getMountDb(mountName);
    if (!mount) return unknownMount(runCtx, mountName);
    const { mountConfig } = mount;

    if (!mountConfig.schema) return [];

    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(mountConfig.schema)) {
      result.push({
        key,
        type: entry.type,
        description: entry.description ?? '',
      });
    }
    return result;
  };

  const mountsList: CallableFn = () => {
    const result: RillValue[] = [];
    for (const [name, mountConfig] of Object.entries(config.mounts)) {
      result.push({
        name,
        mode: mountConfig.mode,
        schema: mountConfig.schema ? 'declared' : 'open',
        maxEntries: mountConfig.maxEntries ?? 10000,
        maxValueSize: mountConfig.maxValueSize ?? 102400,
        database: mountConfig.database,
        table: mountConfig.table,
      });
    }
    return result;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const fnDict: {
    get: RillFunction;
    get_or: RillFunction;
    set: RillFunction;
    merge: RillFunction;
    delete: RillFunction;
    keys: RillFunction;
    has: RillFunction;
    clear: RillFunction;
    getAll: RillFunction;
    schema: RillFunction;
    mounts: RillFunction;
  } = {
    get: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to retrieve')],
      fn: get,
      annotations: { description: 'Get value or schema default' },
      returnType: anyTypeValue,
    },
    get_or: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to retrieve'),
        p.dict('fallback', 'Fallback value if key missing'),
      ],
      fn: get_or,
      annotations: {
        description: 'Get value or return fallback if key missing',
      },
      returnType: anyTypeValue,
    },
    set: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to set'),
        p.str('value', 'Value to store'),
      ],
      fn: set,
      annotations: { description: 'Set value with validation' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    merge: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to merge into'),
        p.dict('partial', 'Partial dict to merge'),
      ],
      fn: merge,
      annotations: {
        description: 'Merge partial dict into existing dict value',
      },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    delete: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to delete')],
      fn: deleteKey,
      annotations: { description: 'Delete key' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    keys: {
      params: [p.str('mount', 'Mount name')],
      fn: keys,
      annotations: { description: 'Get all keys in mount' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'string' },
      }),
    },
    has: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to check')],
      fn: has,
      annotations: { description: 'Check key existence' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    clear: {
      params: [p.str('mount', 'Mount name')],
      fn: clear,
      annotations: { description: 'Clear all keys in mount' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    getAll: {
      params: [p.str('mount', 'Mount name')],
      fn: getAll,
      annotations: { description: 'Get all entries as dict' },
      // Homogeneous-value dict per §EXT.8.2: keys are arbitrary user-chosen
      // strings; values are user-stored RillValues whose schema is set by the
      // caller (§EXT.8.3 case 1), so the value type is `any`.
      returnType: structureToTypeValue({
        kind: 'dict',
        valueType: { kind: 'any' },
      }),
    },
    schema: {
      params: [p.str('mount', 'Mount name')],
      fn: schema,
      annotations: { description: 'Get schema information' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            key: { type: { kind: 'string' } },
            type: { type: { kind: 'string' } },
            description: { type: { kind: 'string' } },
          },
        },
      }),
    },
    mounts: {
      params: [],
      fn: mountsList,
      annotations: { description: 'Get list of mount metadata' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            name: { type: { kind: 'string' } },
            mode: { type: { kind: 'string' } },
            schema: { type: { kind: 'string' } },
            maxEntries: { type: { kind: 'number' } },
            maxValueSize: { type: { kind: 'number' } },
            database: { type: { kind: 'string' } },
            table: { type: { kind: 'string' } },
          },
        },
      }),
    },
  };

  const callableDict = {
    get: toCallable(fnDict.get),
    get_or: toCallable(fnDict.get_or),
    set: toCallable(fnDict.set),
    merge: toCallable(fnDict.merge),
    delete: toCallable(fnDict.delete),
    keys: toCallable(fnDict.keys),
    has: toCallable(fnDict.has),
    clear: toCallable(fnDict.clear),
    getAll: toCallable(fnDict.getAll),
    schema: toCallable(fnDict.schema),
    mounts: toCallable(fnDict.mounts),
  } satisfies KvExtensionContract;

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
