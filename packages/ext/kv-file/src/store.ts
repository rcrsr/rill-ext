/**
 * KV store implementation with JSON persistence.
 *
 * Lifecycle: Load (read store file) -> Execute (in-memory) -> Flush (atomic write on dispose)
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError, deserializeValue, type RillValue } from '@rcrsr/rill';
import type { SchemaEntry } from './types.js';

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

/**
 * Create KV store with JSON persistence.
 *
 * @throws RuntimeError RILL-R004 if store file is corrupt
 */
export async function createStore(config: StoreConfig): Promise<{
  get: (key: string) => RillValue | undefined;
  set: (key: string, value: RillValue) => Promise<void>;
  delete: (key: string) => boolean;
  keys: () => string[];
  has: (key: string) => boolean;
  clear: () => void;
  getAll: () => Record<string, RillValue>;
  flush: () => Promise<void>;
}> {
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

  // ----------------------------------------------------------
  // Load phase
  // ----------------------------------------------------------

  try {
    const fileContent = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(fileContent) as Record<string, unknown>;

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new RuntimeError(
        'RILL-R004',
        'state file corrupt — reset or delete to recover',
        undefined,
        { path: storePath },
      );
    }

    if (schema) {
      for (const [key, schemaEntry] of Object.entries(schema)) {
        if (key in parsed) {
          const value = deserializeValue(parsed[key], schemaEntry.type);
          validateType(key, value, schemaEntry.type, storePath);
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
    if (error instanceof RuntimeError) throw error;

    if (
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
    } else if (error instanceof SyntaxError) {
      throw new RuntimeError(
        'RILL-R004',
        'state file corrupt — reset or delete to recover',
        undefined,
        { path: storePath },
      );
    } else {
      throw error;
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  function checkWritePermission(): void {
    if (mode === 'read') {
      throw new RuntimeError(
        'RILL-R004',
        `Mount '${mount}' is read-only (mode: ${mode})`,
        undefined,
        { mode, path: storePath },
      );
    }
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
  ): void {
    let actualType: string;

    if (typeof value === 'string') actualType = 'string';
    else if (typeof value === 'number') actualType = 'number';
    else if (typeof value === 'boolean') actualType = 'bool';
    else if (Array.isArray(value)) actualType = 'list';
    else if (typeof value === 'object' && value !== null) actualType = 'dict';
    else actualType = typeof value;

    if (actualType !== expectedType) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" expects ${expectedType}, got ${actualType}`,
        undefined,
        { key, expectedType, actualType, location },
      );
    }
  }

  // ----------------------------------------------------------
  // Operations
  // ----------------------------------------------------------

  function get(key: string): RillValue | undefined {
    if (schema && !(key in schema)) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" not declared in schema`,
        undefined,
        { key },
      );
    }
    return data.get(key);
  }

  async function set(key: string, value: RillValue): Promise<void> {
    checkWritePermission();

    if (schema && !(key in schema)) {
      throw new RuntimeError(
        'RILL-R004',
        `key "${key}" not declared in schema`,
        undefined,
        { key },
      );
    }

    if (schema && key in schema) {
      validateType(key, value, schema[key]!.type, storePath);
    }

    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      throw new RuntimeError(
        'RILL-R004',
        `value for "${key}" exceeds size limit`,
        undefined,
        { key, size: valueSize, max: maxValueSize },
      );
    }

    if (!data.has(key) && data.size >= maxEntries) {
      throw new RuntimeError(
        'RILL-R004',
        `store exceeds entry limit (${data.size + 1} > ${maxEntries})`,
        undefined,
        { count: data.size + 1, max: maxEntries },
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
      throw new RuntimeError(
        'RILL-R004',
        `store exceeds size limit (${storeSize} > ${maxStoreSize})`,
        undefined,
        { size: storeSize, max: maxStoreSize },
      );
    }

    if (writePolicy === 'immediate') {
      await flush();
    }
  }

  function deleteKey(key: string): boolean {
    checkWritePermission();
    return data.delete(key);
  }

  function keys(): string[] {
    return Array.from(data.keys());
  }

  function has(key: string): boolean {
    return data.has(key);
  }

  function clear(): void {
    checkWritePermission();
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

  return { get, set, delete: deleteKey, keys, has, clear, getAll, flush };
}
