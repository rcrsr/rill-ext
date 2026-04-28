/**
 * KV store implementation with JSON persistence.
 *
 * Lifecycle: Load (read store file) -> Execute (in-memory) -> Flush (atomic write on dispose)
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deserializeValue,
  isInvalid,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { SchemaEntry } from './types.js';

const PROVIDER = 'kv-file';

/** Store configuration. */
export interface StoreConfig {
  readonly mount: string;
  readonly store: string;
  readonly schema?: Record<string, SchemaEntry> | undefined;
  readonly maxEntries: number;
  readonly maxValueSize: number;
  readonly maxStoreSize: number;
  readonly writePolicy: 'dispose' | 'immediate';
  readonly mode: 'read' | 'write' | 'read-write';
}

/** Sentinel raised internally to short-circuit load with a RillValue invalid. */
class LoadInvalid {
  constructor(public readonly value: RillValue) {}
}

export interface KvStore {
  loadError: RillValue | null;
  get: (key: string, ctx: RuntimeContext) => RillValue | undefined | RillValue;
  set: (key: string, value: RillValue, ctx: RuntimeContext) => Promise<void | RillValue>;
  delete: (key: string, ctx: RuntimeContext) => boolean | RillValue;
  keys: () => string[];
  has: (key: string) => boolean;
  clear: (ctx: RuntimeContext) => void | RillValue;
  getAll: () => Record<string, RillValue>;
  flush: () => Promise<void>;
}

/**
 * Create KV store with JSON persistence.
 *
 * Returns a store whose `loadError` is set to an invalid `RillValue` if the
 * load phase failed (corrupt file, schema mismatch). Operations otherwise
 * accept a `RuntimeContext` and return invalid `RillValue`s on failure.
 */
export async function createStore(
  config: StoreConfig,
  ctx: RuntimeContext,
): Promise<KvStore> {
  const {
    mount,
    maxEntries,
    maxValueSize,
    maxStoreSize,
    writePolicy,
    mode,
    schema,
  } = config;

  const storePath = path.resolve(config.store);
  const storeDir = path.dirname(storePath);

  await fs.mkdir(storeDir, { recursive: true });

  const data = new Map<string, RillValue>();
  let loadError: RillValue | null = null;

  // ----------------------------------------------------------
  // Load phase
  // ----------------------------------------------------------

  try {
    const fileContent = await fs.readFile(storePath, 'utf-8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fileContent) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new LoadInvalid(
          ctx.invalidate(
            new Error('state file corrupt — reset or delete to recover'),
            {
              code: 'UNAVAILABLE',
              provider: PROVIDER,
              raw: { kind: 'corrupt_file', path: storePath },
            },
          ),
        );
      }
      throw e;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new LoadInvalid(
        ctx.invalidate(
          new Error('state file corrupt — reset or delete to recover'),
          {
            code: 'UNAVAILABLE',
            provider: PROVIDER,
            raw: { kind: 'corrupt_file', path: storePath },
          },
        ),
      );
    }

    if (schema) {
      for (const [key, schemaEntry] of Object.entries(schema)) {
        if (key in parsed) {
          const value = deserializeValue(parsed[key], schemaEntry.type);
          const typeErr = validateType(
            key,
            value,
            schemaEntry.type,
            storePath,
            ctx,
          );
          if (typeErr !== null) throw new LoadInvalid(typeErr);
          data.set(key, value);
        } else {
          data.set(key, schemaEntry.default);
        }
      }
    } else {
      for (const [key, value] of Object.entries(parsed)) {
        data.set(key, value as RillValue);
      }
    }
  } catch (error) {
    if (error instanceof LoadInvalid) {
      loadError = error.value;
    } else if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    ) {
      if (schema) {
        for (const [key, schemaEntry] of Object.entries(schema)) {
          data.set(key, schemaEntry.default);
        }
      }
    } else {
      throw error;
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  function checkWritePermission(runCtx: RuntimeContext): RillValue | null {
    if (mode === 'read') {
      return runCtx.invalidate(
        new Error(`Mount '${mount}' is read-only (mode: ${mode})`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'read_only', mode, path: storePath },
        },
      );
    }
    return null;
  }

  function calculateValueSize(value: RillValue): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf-8');
  }

  function calculateStoreSize(): number {
    const entries: Record<string, RillValue> = {};
    for (const [key, value] of data.entries()) {
      entries[key] = value;
    }
    return Buffer.byteLength(JSON.stringify(entries), 'utf-8');
  }

  function validateType(
    key: string,
    value: RillValue,
    expectedType: SchemaEntry['type'],
    location: string,
    runCtx: RuntimeContext,
  ): RillValue | null {
    let actualType: string;

    if (typeof value === 'string') actualType = 'string';
    else if (typeof value === 'number') actualType = 'number';
    else if (typeof value === 'boolean') actualType = 'bool';
    else if (Array.isArray(value)) actualType = 'list';
    else if (typeof value === 'object' && value !== null) actualType = 'dict';
    else actualType = typeof value;

    if (actualType !== expectedType) {
      return runCtx.invalidate(
        new Error(`key "${key}" expects ${expectedType}, got ${actualType}`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'type_mismatch', key, expectedType, actualType, location },
        },
      );
    }
    return null;
  }

  // ----------------------------------------------------------
  // Operations
  // ----------------------------------------------------------

  function get(key: string, runCtx: RuntimeContext): RillValue | undefined | RillValue {
    if (schema && !(key in schema)) {
      return runCtx.invalidate(
        new Error(`key "${key}" not declared in schema`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'undeclared_key', key },
        },
      );
    }
    return data.get(key);
  }

  async function set(
    key: string,
    value: RillValue,
    runCtx: RuntimeContext,
  ): Promise<void | RillValue> {
    const writeErr = checkWritePermission(runCtx);
    if (writeErr !== null) return writeErr;

    if (schema && !(key in schema)) {
      return runCtx.invalidate(
        new Error(`key "${key}" not declared in schema`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'undeclared_key', key },
        },
      );
    }

    if (schema && key in schema) {
      const typeErr = validateType(key, value, schema[key]!.type, storePath, runCtx);
      if (typeErr !== null) return typeErr;
    }

    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      return runCtx.invalidate(
        new Error(`value for "${key}" exceeds size limit`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'value_too_large', key, size: valueSize, max: maxValueSize },
        },
      );
    }

    if (!data.has(key) && data.size >= maxEntries) {
      return runCtx.invalidate(
        new Error(`store exceeds entry limit (${data.size + 1} > ${maxEntries})`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'entry_limit', count: data.size + 1, max: maxEntries },
        },
      );
    }

    const oldValue = data.get(key);
    const hadKey = data.has(key);

    data.set(key, value);

    const storeSize = calculateStoreSize();
    if (storeSize > maxStoreSize) {
      if (hadKey) {
        data.set(key, oldValue!);
      } else {
        data.delete(key);
      }
      return runCtx.invalidate(
        new Error(`store exceeds size limit (${storeSize} > ${maxStoreSize})`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'store_limit', size: storeSize, max: maxStoreSize },
        },
      );
    }

    if (writePolicy === 'immediate') {
      await flush();
    }
  }

  function deleteKey(key: string, runCtx: RuntimeContext): boolean | RillValue {
    const writeErr = checkWritePermission(runCtx);
    if (writeErr !== null) return writeErr;
    return data.delete(key);
  }

  function keys(): string[] {
    return Array.from(data.keys());
  }

  function has(key: string): boolean {
    return data.has(key);
  }

  function clear(runCtx: RuntimeContext): void | RillValue {
    const writeErr = checkWritePermission(runCtx);
    if (writeErr !== null) return writeErr;
    data.clear();
    if (schema) {
      for (const [key, schemaEntry] of Object.entries(schema)) {
        data.set(key, schemaEntry.default);
      }
    }
  }

  function getAll(): Record<string, RillValue> {
    const result: Record<string, RillValue> = {};
    for (const [key, value] of data.entries()) {
      result[key] = value;
    }
    return result;
  }

  async function flush(): Promise<void> {
    const entries = getAll();
    const content = JSON.stringify(entries, null, 2);
    const tmpPath = `${storePath}.tmp`;

    try {
      await fs.writeFile(tmpPath, content, 'utf-8');
      await fs.rename(tmpPath, storePath);
    } catch (error) {
      console.warn(
        `[KV Store] Failed to flush state to ${storePath}:`,
        error,
      );
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return {
    loadError,
    get,
    set,
    delete: deleteKey,
    keys,
    has,
    clear,
    getAll,
    flush,
  };
}

export { isInvalid };
