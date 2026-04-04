/**
 * Factory function for creating file-based kv extension.
 *
 * @module
 */

import {
  RuntimeError,
  isDict,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type KvExtensionContract,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { KvFileExtensionConfig, KvFileMountConfig } from './types.js';
import { createStore } from './store.js';

const anyReturn = structureToTypeValue({ kind: 'any' });
const boolReturn = structureToTypeValue({ kind: 'bool' });
const listReturn = structureToTypeValue({ kind: 'list' });
const dictReturn = structureToTypeValue({ kind: 'dict' });

/**
 * Creates a file-based kv extension with JSON persistence.
 *
 * Supports both mount-based configuration and legacy single-store configuration.
 * Returns 11 functions: get, get_or, set, merge, delete, keys, has, clear, getAll, schema, mounts.
 */
export function createFileKvExtension(
  config: KvFileExtensionConfig,
): ExtensionFactoryResult {
  let mounts: Record<string, KvFileMountConfig>;

  if (config.mounts) {
    mounts = { ...config.mounts };
  } else if (config.store) {
    mounts = {
      default: {
        mode: config.mode ?? 'read-write',
        store: config.store,
        schema: config.schema,
        maxEntries: config.maxEntries,
        maxValueSize: config.maxValueSize,
        maxStoreSize: config.maxStoreSize,
        writePolicy: config.writePolicy,
      },
    };
  } else {
    throw new Error(
      'KV file extension requires either "mounts" or "store" configuration',
    );
  }

  // Store instances keyed by mount name (lazy-initialized)
  const stores = new Map<
    string,
    {
      promise: Promise<Awaited<ReturnType<typeof createStore>>> | null;
      instance: Awaited<ReturnType<typeof createStore>> | null;
    }
  >();

  for (const mountName of Object.keys(mounts)) {
    stores.set(mountName, { promise: null, instance: null });
  }

  const getStore = async (
    mountName: string,
  ): Promise<Awaited<ReturnType<typeof createStore>>> => {
    const mountConfig = mounts[mountName];
    if (!mountConfig) {
      throw new RuntimeError(
        'RILL-R004',
        `Mount '${mountName}' not found`,
        undefined,
        { mountName, availableMounts: Object.keys(mounts) },
      );
    }

    const storeState = stores.get(mountName)!;
    if (storeState.instance) return storeState.instance;

    if (!storeState.promise) {
      storeState.promise = createStore({
        mount: mountName,
        store: mountConfig.store,
        schema: mountConfig.schema,
        maxEntries: mountConfig.maxEntries ?? 10000,
        maxValueSize: mountConfig.maxValueSize ?? 102400,
        maxStoreSize: mountConfig.maxStoreSize ?? 10485760,
        writePolicy: mountConfig.writePolicy ?? 'dispose',
        mode: mountConfig.mode,
      });
    }

    storeState.instance = await storeState.promise;
    return storeState.instance;
  };

  // ----------------------------------------------------------
  // Functions
  // ----------------------------------------------------------

  const get = async (args: Record<string, RillValue>): Promise<RillValue> => {
    const store = await getStore(args['mount'] as string);
    const value = store.get(args['key'] as string);
    return value !== undefined ? value : '';
  };

  const get_or = async (args: Record<string, RillValue>): Promise<RillValue> => {
    const store = await getStore(args['mount'] as string);
    const key = args['key'] as string;
    if (store.has(key)) return store.get(key)!;
    return args['fallback'] as RillValue;
  };

  const set = async (args: Record<string, RillValue>): Promise<boolean> => {
    const store = await getStore(args['mount'] as string);
    await store.set(args['key'] as string, args['value'] as RillValue);
    return true;
  };

  const merge = async (args: Record<string, RillValue>): Promise<boolean> => {
    const store = await getStore(args['mount'] as string);
    const key = args['key'] as string;
    const partial = args['partial'] as Record<string, RillValue>;
    const currentValue = store.get(key);

    if (currentValue !== undefined && !isDict(currentValue)) {
      throw new RuntimeError(
        'RILL-R004',
        `Cannot merge into non-dict value at key "${key}"`,
        undefined,
        { key, currentType: typeof currentValue },
      );
    }

    const mergedValue = {
      ...(currentValue as Record<string, RillValue> | undefined),
      ...partial,
    };
    await store.set(key, mergedValue);
    return true;
  };

  const deleteKey = async (args: Record<string, RillValue>): Promise<boolean> => {
    const store = await getStore(args['mount'] as string);
    return store.delete(args['key'] as string);
  };

  const keys = async (args: Record<string, RillValue>): Promise<string[]> => {
    const store = await getStore(args['mount'] as string);
    return store.keys();
  };

  const has = async (args: Record<string, RillValue>): Promise<boolean> => {
    const store = await getStore(args['mount'] as string);
    return store.has(args['key'] as string);
  };

  const clear = async (args: Record<string, RillValue>): Promise<boolean> => {
    const store = await getStore(args['mount'] as string);
    store.clear();
    return true;
  };

  const getAll = async (
    args: Record<string, RillValue>,
  ): Promise<Record<string, RillValue>> => {
    const store = await getStore(args['mount'] as string);
    return store.getAll();
  };

  const schema = async (args: Record<string, RillValue>): Promise<RillValue[]> => {
    const mountName = args['mount'] as string;
    const mountConfig = mounts[mountName];

    if (!mountConfig) {
      throw new RuntimeError(
        'RILL-R004',
        `Mount '${mountName}' not found`,
        undefined,
        { mountName, availableMounts: Object.keys(mounts) },
      );
    }

    if (!mountConfig.schema) return [];

    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(mountConfig.schema)) {
      result.push({ key, type: entry.type, description: entry.description ?? '' });
    }
    return result;
  };

  const mountsList = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];
    for (const [name, cfg] of Object.entries(mounts)) {
      result.push({
        name,
        mode: cfg.mode,
        schema: cfg.schema ? 'declared' : 'open',
        maxEntries: cfg.maxEntries ?? 10000,
        maxValueSize: cfg.maxValueSize ?? 102400,
      });
    }
    return result;
  };

  // ----------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------

  const dispose = async (): Promise<void> => {
    const flushPromises: Promise<void>[] = [];
    for (const storeState of stores.values()) {
      if (storeState.instance) {
        flushPromises.push(storeState.instance.flush());
      }
    }
    await Promise.all(flushPromises);
  };

  // ----------------------------------------------------------
  // RillFunction definitions
  // ----------------------------------------------------------

  const fnDict = {
    get: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to retrieve')],
      fn: get,
      annotations: { description: 'Get value or schema default' },
      returnType: anyReturn,
    } satisfies RillFunction,
    get_or: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to retrieve'),
        p.dict('fallback', 'Fallback value if key missing'),
      ],
      fn: get_or,
      annotations: { description: 'Get value or return fallback if key missing' },
      returnType: anyReturn,
    } satisfies RillFunction,
    set: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to set'),
        p.str('value', 'Value to store'),
      ],
      fn: set,
      annotations: { description: 'Set value with validation' },
      returnType: boolReturn,
    } satisfies RillFunction,
    merge: {
      params: [
        p.str('mount', 'Mount name'),
        p.str('key', 'Key to merge into'),
        p.dict('partial', 'Partial dict to merge'),
      ],
      fn: merge,
      annotations: { description: 'Merge partial dict into existing dict value' },
      returnType: boolReturn,
    } satisfies RillFunction,
    delete: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to delete')],
      fn: deleteKey,
      annotations: { description: 'Delete key' },
      returnType: boolReturn,
    } satisfies RillFunction,
    keys: {
      params: [p.str('mount', 'Mount name')],
      fn: keys,
      annotations: { description: 'Get all keys in mount' },
      returnType: listReturn,
    } satisfies RillFunction,
    has: {
      params: [p.str('mount', 'Mount name'), p.str('key', 'Key to check')],
      fn: has,
      annotations: { description: 'Check key existence' },
      returnType: boolReturn,
    } satisfies RillFunction,
    clear: {
      params: [p.str('mount', 'Mount name')],
      fn: clear,
      annotations: { description: 'Clear all keys in mount' },
      returnType: boolReturn,
    } satisfies RillFunction,
    getAll: {
      params: [p.str('mount', 'Mount name')],
      fn: getAll,
      annotations: { description: 'Get all entries as dict' },
      returnType: dictReturn,
    } satisfies RillFunction,
    schema: {
      params: [p.str('mount', 'Mount name')],
      fn: schema,
      annotations: { description: 'Get schema information' },
      returnType: listReturn,
    } satisfies RillFunction,
    mounts: {
      params: [],
      fn: mountsList,
      annotations: { description: 'Get list of mount metadata' },
      returnType: listReturn,
    } satisfies RillFunction,
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
