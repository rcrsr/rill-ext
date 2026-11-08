/**
 * Factory function for creating file-based kv extension.
 *
 * @module
 */

import {
  RuntimeError,
  isDict,
  isInvalid,
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
import type { KvExtensionContract } from '@rcrsr/rill-ext-kv-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { KvFileExtensionConfig, KvFileMountConfig } from './types.js';
import { createStore, type KvStore } from './store.js';

const anyReturn = structureToTypeValue({ kind: 'any' });
const boolReturn = structureToTypeValue({ kind: 'bool' });
const listReturn = structureToTypeValue({ kind: 'list' });
// getAll returns a homogeneous-value dict per §EXT.8.2: keys are arbitrary
// user-chosen strings; values are user-stored RillValues whose schema is set
// by the caller (§EXT.8.3 case 1), so the value type is `any`.
const getAllReturn = structureToTypeValue({
  kind: 'dict',
  valueType: { kind: 'any' },
});

const PROVIDER = 'kv-file';

/**
 * Builds the halt for a call made after dispose(). Returns a catchable
 * halt carrying #DISPOSED (raw.kind 'extension_disposed') for the caller to throw.
 */
function failDisposed(ctx: RuntimeContext): RuntimeHaltSignal {
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error(`${PROVIDER}: extension disposed`), {
      code: 'DISPOSED',
      provider: PROVIDER,
      raw: { kind: 'extension_disposed' },
    }),
    true
  );
}

/**
 * Creates a file-based kv extension with JSON persistence.
 *
 * Supports both mount-based configuration and legacy single-store configuration.
 * Returns 11 functions: get, get_or, set, merge, delete, keys, has, clear, getAll, schema, mounts.
 */
export function createFileKvExtension(
  config: KvFileExtensionConfig,
  _ctx: ExtensionFactoryCtx
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
    throw new RuntimeError(
      'RILL-R001',
      'KV file extension requires either "mounts" or "store" configuration'
    );
  }

  let disposed = false;

  // Store instances keyed by mount name (lazy-initialized)
  const stores = new Map<
    string,
    {
      promise: Promise<KvStore> | null;
      instance: KvStore | null;
    }
  >();

  for (const mountName of Object.keys(mounts)) {
    stores.set(mountName, { promise: null, instance: null });
  }

  type StoreResolution =
    | { ok: true; store: KvStore }
    | { ok: false; invalid: RillValue };

  /**
   * Lazily resolves a store. Returns either the store or an invalid `RillValue`
   * for unknown mount / load failure.
   */
  const getStore = async (
    mountName: string,
    runCtx: RuntimeContext
  ): Promise<StoreResolution> => {
    const mountConfig = mounts[mountName];
    if (!mountConfig) {
      return {
        ok: false,
        invalid: runCtx.invalidate(
          new Error(`Mount '${mountName}' not found`),
          {
            code: 'INVALID_INPUT',
            provider: PROVIDER,
            raw: {
              kind: 'unknown_mount',
              mountName,
              availableMounts: Object.keys(mounts),
            },
          }
        ),
      };
    }

    const storeState = stores.get(mountName)!;
    if (storeState.instance) {
      if (storeState.instance.loadError !== null) {
        return { ok: false, invalid: storeState.instance.loadError };
      }
      return { ok: true, store: storeState.instance };
    }

    if (!storeState.promise) {
      storeState.promise = createStore(
        {
          mount: mountName,
          store: mountConfig.store,
          schema: mountConfig.schema,
          maxEntries: mountConfig.maxEntries ?? 10000,
          maxValueSize: mountConfig.maxValueSize ?? 102400,
          maxStoreSize: mountConfig.maxStoreSize ?? 10485760,
          writePolicy: mountConfig.writePolicy ?? 'dispose',
          mode: mountConfig.mode,
        },
        runCtx
      );
    }

    storeState.instance = await storeState.promise;
    // dispose() may have run while the store loaded; it flushed only stores
    // already resolved, so this call must not touch the store.
    if (disposed) throw failDisposed(runCtx);
    if (storeState.instance.loadError !== null) {
      return { ok: false, invalid: storeState.instance.loadError };
    }
    return { ok: true, store: storeState.instance };
  };

  // ----------------------------------------------------------
  // Functions
  // ----------------------------------------------------------

  const get: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const value = r.store.get(args['key'] as string, runCtx);
    if (value !== undefined && isInvalid(value)) return value as RillValue;
    return value !== undefined ? (value as RillValue) : '';
  };

  const get_or: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const key = args['key'] as string;
    if (r.store.has(key)) {
      const v = r.store.get(key, runCtx);
      if (v !== undefined && isInvalid(v)) return v as RillValue;
      return v as RillValue;
    }
    return args['fallback'] as RillValue;
  };

  const set: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const setResult = await r.store.set(
      args['key'] as string,
      args['value'] as RillValue,
      runCtx
    );
    if (setResult !== undefined) return setResult as RillValue;
    return true;
  };

  const merge: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const key = args['key'] as string;
    const partial = args['partial'] as Record<string, RillValue>;
    const currentValue = r.store.get(key, runCtx);
    if (currentValue !== undefined && isInvalid(currentValue)) {
      return currentValue as RillValue;
    }

    if (currentValue !== undefined && !isDict(currentValue)) {
      return runCtx.invalidate(
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
    }

    const mergedValue = {
      ...(currentValue as Record<string, RillValue> | undefined),
      ...partial,
    };
    const setResult = await r.store.set(key, mergedValue, runCtx);
    if (setResult !== undefined) return setResult as RillValue;
    return true;
  };

  const deleteKey: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const result = r.store.delete(args['key'] as string, runCtx);
    if (typeof result !== 'boolean') return result as RillValue;
    return result;
  };

  const keys: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    return r.store.keys();
  };

  const has: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    return r.store.has(args['key'] as string);
  };

  const clear: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    const result = r.store.clear(runCtx);
    if (result !== undefined) return result as RillValue;
    return true;
  };

  const getAll: CallableFn = async (args, ctx) => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) throw failDisposed(runCtx);
    const r = await getStore(args['mount'] as string, runCtx);
    if (!r.ok) return r.invalid;
    return r.store.getAll();
  };

  const schema: CallableFn = (args, ctx): Promise<RillValue> => {
    const runCtx = ctx as RuntimeContext;
    if (disposed) return Promise.reject(failDisposed(runCtx));
    const mountName = args['mount'] as string;
    const mountConfig = mounts[mountName];

    if (!mountConfig) {
      return Promise.resolve(
        runCtx.invalidate(new Error(`Mount '${mountName}' not found`), {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'unknown_mount',
            mountName,
            availableMounts: Object.keys(mounts),
          },
        })
      );
    }

    if (!mountConfig.schema) return Promise.resolve([]);

    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(mountConfig.schema)) {
      result.push({
        key,
        type: entry.type,
        description: entry.description ?? '',
      });
    }
    return Promise.resolve(result);
  };

  const mountsList: CallableFn = (_args, ctx): Promise<RillValue> => {
    if (disposed) return Promise.reject(failDisposed(ctx as RuntimeContext));
    const result: RillValue[] = [];
    for (const [name, cfg] of Object.entries(mounts)) {
      result.push({
        name,
        mode: cfg.mode,
        schema: cfg.schema ? 'declared' : 'open',
        max_entries: cfg.maxEntries ?? 10000,
        max_value_size: cfg.maxValueSize ?? 102400,
      });
    }
    return Promise.resolve(result);
  };

  // ----------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    const flushPromises: Promise<void>[] = [];
    for (const storeState of stores.values()) {
      if (storeState.instance && storeState.instance.loadError === null) {
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
      annotations: {
        description: 'Get value or return fallback if key missing',
      },
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
      annotations: {
        description: 'Merge partial dict into existing dict value',
      },
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
      returnType: getAllReturn,
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
