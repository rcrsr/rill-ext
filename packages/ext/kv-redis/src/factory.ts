/**
 * Factory function for creating Redis kv extension.
 *
 * @module
 */

import { Redis } from 'ioredis';
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
import { mapKvError, type KvExtensionContract } from '@rcrsr/rill-ext-kv-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { RedisKvMountConfig } from './types.js';

const PROVIDER = 'kv-redis';

/**
 * Configuration for Redis kv extension factory.
 */
export interface RedisKvExtensionConfig {
  /** Redis connection URL (e.g., "redis://localhost:6379") */
  readonly url: string;

  /** Mount point configurations */
  readonly mounts: Record<string, RedisKvMountConfig>;

  /** Maximum store size in bytes (optional) */
  readonly maxStoreSize?: number | undefined;

  /** Write policy: 'dispose' (write on dispose) or 'immediate' (write immediately) */
  readonly writePolicy?: 'dispose' | 'immediate' | undefined;
}

/**
 * Creates a Redis kv backend extension for rill.
 */
export function createRedisKvExtension(
  config: RedisKvExtensionConfig,
  ctx: ExtensionFactoryCtx,
): ExtensionFactoryResult {
  // Factory-time config validation
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new RuntimeError(
      'RILL-R005',
      'Redis kv extension requires at least one mount in configuration',
    );
  }

  if (!config.url || typeof config.url !== 'string') {
    throw new RuntimeError(
      'RILL-R005',
      'Redis kv extension requires a valid connection URL',
    );
  }

  if (!config.url.startsWith('redis://') && !config.url.startsWith('rediss://')) {
    throw new RuntimeError(
      'RILL-R005',
      `Invalid Redis connection URL: must start with redis:// or rediss:// (got: ${config.url})`,
    );
  }

  const prefixes = Object.entries(config.mounts).map(([name, cfg]) => ({
    name,
    prefix: cfg.prefix,
  }));

  for (let i = 0; i < prefixes.length; i++) {
    for (let j = i + 1; j < prefixes.length; j++) {
      const a = prefixes[i]!;
      const b = prefixes[j]!;
      if (a.prefix.startsWith(b.prefix) || b.prefix.startsWith(a.prefix)) {
        throw new RuntimeError(
          'RILL-R005',
          `Mount prefix overlap detected: "${a.name}" (${a.prefix}) and "${b.name}" (${b.prefix})`,
        );
      }
    }
  }

  let client: Redis;
  try {
    client = new Redis(config.url);
  } catch (error: unknown) {
    throw new RuntimeError(
      'RILL-R005',
      `Failed to create Redis client: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  client.on('error', (err: Error) => {
    console.error('Redis connection error:', err);
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };

  if (ctx?.signal) {
    if (ctx.signal.aborted) {
      void dispose();
    } else {
      ctx.signal.addEventListener(
        'abort',
        () => {
          void dispose();
        },
        { once: true },
      );
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function getMountConfig(mountName: string): RedisKvMountConfig | undefined {
    return config.mounts[mountName];
  }

  function buildKey(prefix: string, key: string): string {
    return `${prefix}${key}`;
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
      new Error(`Mount '${mountName}' not found. Available mounts: ${available.join(', ')}`),
      {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: {
          kind: 'unknown_mount',
          mountName,
          availableMounts: available,
        },
      },
    );
  }

  function readonlyMount(runCtx: RuntimeContext, mountName: string, mode: string): RillValue {
    return runCtx.invalidate(
      new Error(`Mount '${mountName}' is read-only (mode: ${mode})`),
      {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'readonly_mount', mountName, mode },
      },
    );
  }

  function disposedInvalid(runCtx: RuntimeContext): RillValue {
    return runCtx.invalidate(new Error('Redis kv extension disposed'), {
      code: 'DISPOSED',
      provider: PROVIDER,
      raw: { kind: 'extension_disposed' },
    });
  }

  async function scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, foundKeys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');
    return keys;
  }

  // ============================================================
  // KV FUNCTIONS
  // ============================================================

  const get: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (mountConfig.schema && !(key in mountConfig.schema)) {
      return runCtx.invalidate(new Error(`key "${key}" not declared in schema`), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'schema_violation', mount: mountName, key },
      });
    }

    try {
      const redisKey = buildKey(mountConfig.prefix, key);
      const value = await client.get(redisKey);
      if (value !== null) return JSON.parse(value) as RillValue;
      if (mountConfig.schema && key in mountConfig.schema) {
        return mountConfig.schema[key]!.default;
      }
      return '';
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const get_or: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const fallback = args['fallback'] as RillValue;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    try {
      const redisKey = buildKey(mountConfig.prefix, key);
      const value = await client.get(redisKey);
      if (value !== null) return JSON.parse(value) as RillValue;
      return fallback;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const set: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const value = args['value'] as RillValue;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (mountConfig.mode === 'read') {
      return readonlyMount(runCtx, mountName, mountConfig.mode);
    }

    if (mountConfig.schema && !(key in mountConfig.schema)) {
      return runCtx.invalidate(new Error(`key "${key}" not declared in schema`), {
        code: 'INVALID_INPUT',
        provider: PROVIDER,
        raw: { kind: 'schema_violation', mount: mountName, key },
      });
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
          },
        );
      }
    }

    const maxValueSize = mountConfig.maxValueSize ?? 102400;
    const valueSize = calculateValueSize(value);
    if (valueSize > maxValueSize) {
      return runCtx.invalidate(
        new Error(`value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'value_too_large', key, valueSize, maxValueSize },
        },
      );
    }

    try {
      const maxEntries = mountConfig.maxEntries ?? 10000;
      const redisKey = buildKey(mountConfig.prefix, key);
      const exists = (await client.exists(redisKey)) === 1;

      if (!exists) {
        const pattern = `${mountConfig.prefix}*`;
        const keys = await scanKeys(pattern);
        if (keys.length >= maxEntries) {
          return runCtx.invalidate(
            new Error(`store exceeds entry limit (${keys.length + 1} > ${maxEntries})`),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'entry_limit_exceeded', count: keys.length + 1, maxEntries },
            },
          );
        }
      }

      const serialized = JSON.stringify(value);
      if (mountConfig.ttl) {
        await client.setex(redisKey, mountConfig.ttl, serialized);
      } else {
        await client.set(redisKey, serialized);
      }
      return true;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const merge: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const partial = args['partial'] as Record<string, RillValue>;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (mountConfig.mode === 'read') {
      return readonlyMount(runCtx, mountName, mountConfig.mode);
    }

    const redisKey = buildKey(mountConfig.prefix, key);
    const MAX_RETRIES = 10;

    try {
      for (let retries = 0; retries < MAX_RETRIES; retries++) {
        await client.watch(redisKey);
        const currentValueStr = await client.get(redisKey);
        let currentValue: RillValue | undefined;

        if (currentValueStr !== null) {
          currentValue = JSON.parse(currentValueStr) as RillValue;
          if (!isDictValue(currentValue)) {
            await client.unwatch();
            return runCtx.invalidate(
              new Error(`Cannot merge into non-dict value at key "${key}"`),
              {
                code: 'INVALID_INPUT',
                provider: PROVIDER,
                raw: { kind: 'merge_non_dict', key, currentType: typeof currentValue },
              },
            );
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
            await client.unwatch();
            return runCtx.invalidate(
              new Error(`key "${key}" expects ${expected}, got ${actual}`),
              {
                code: 'TYPE_MISMATCH',
                provider: PROVIDER,
                raw: { kind: 'type_mismatch', key, expected, actual },
              },
            );
          }
        }

        const maxValueSize = mountConfig.maxValueSize ?? 102400;
        const valueSize = calculateValueSize(mergedValue);
        if (valueSize > maxValueSize) {
          await client.unwatch();
          return runCtx.invalidate(
            new Error(
              `merged value for "${key}" exceeds size limit (${valueSize} > ${maxValueSize})`,
            ),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'value_too_large', key, valueSize, maxValueSize },
            },
          );
        }

        const serialized = JSON.stringify(mergedValue);
        const result = await client.multi().set(redisKey, serialized).exec();

        if (result !== null) {
          if (mountConfig.ttl) {
            await client.expire(redisKey, mountConfig.ttl);
          }
          return true;
        }
      }

      return runCtx.invalidate(
        new Error(`Failed to merge after ${MAX_RETRIES} retries due to concurrent modifications`),
        {
          code: 'CONFLICT',
          provider: PROVIDER,
          raw: { kind: 'merge_retry_exhausted', key, retries: MAX_RETRIES },
        },
      );
    } catch (error) {
      try {
        await client.unwatch();
      } catch {
        // ignore
      }
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const deleteKey: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (mountConfig.mode === 'read') {
      return readonlyMount(runCtx, mountName, mountConfig.mode);
    }

    try {
      const redisKey = buildKey(mountConfig.prefix, key);
      const result = await client.del(redisKey);
      return result > 0;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const keys: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    try {
      const pattern = `${mountConfig.prefix}*`;
      const redisKeys = await scanKeys(pattern);
      const prefixLen = mountConfig.prefix.length;
      return redisKeys.map((k) => k.substring(prefixLen));
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const has: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const key = args['key'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    try {
      const redisKey = buildKey(mountConfig.prefix, key);
      const exists = await client.exists(redisKey);
      return exists === 1;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const clear: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (mountConfig.mode === 'read') {
      return readonlyMount(runCtx, mountName, mountConfig.mode);
    }

    try {
      const pattern = `${mountConfig.prefix}*`;
      const redisKeys = await scanKeys(pattern);
      if (redisKeys.length > 0) {
        await client.del(...redisKeys);
      }

      if (mountConfig.schema) {
        const pipeline = client.pipeline();
        for (const [k, entry] of Object.entries(mountConfig.schema)) {
          const redisKey = buildKey(mountConfig.prefix, k);
          const serialized = JSON.stringify(entry.default);
          if (mountConfig.ttl) {
            pipeline.setex(redisKey, mountConfig.ttl, serialized);
          } else {
            pipeline.set(redisKey, serialized);
          }
        }
        await pipeline.exec();
      }

      return true;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const getAll: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    if (disposed) return disposedInvalid(runCtx);
    const mountName = args['mount'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    try {
      const pattern = `${mountConfig.prefix}*`;
      const redisKeys = await scanKeys(pattern);
      if (redisKeys.length === 0) return {};

      const values = await client.mget(...redisKeys);
      const result: Record<string, RillValue> = {};
      const prefixLen = mountConfig.prefix.length;

      for (let i = 0; i < redisKeys.length; i++) {
        const k = redisKeys[i]!.substring(prefixLen);
        const value = values[i];
        if (value !== null && value !== undefined) {
          result[k] = JSON.parse(value) as RillValue;
        }
      }
      return result;
    } catch (error) {
      return mapKvError(runCtx, PROVIDER, error);
    }
  };

  const schema: CallableFn = async (args, runtimeCtx) => {
    const runCtx = runtimeCtx as RuntimeContext;
    const mountName = args['mount'] as string;
    const mountConfig = getMountConfig(mountName);
    if (!mountConfig) return unknownMount(runCtx, mountName);

    if (!mountConfig.schema) return [];

    const result: RillValue[] = [];
    for (const [key, entry] of Object.entries(mountConfig.schema)) {
      result.push({ key, type: entry.type, description: entry.description ?? '' });
    }
    return result;
  };

  const mountsList: CallableFn = async () => {
    const result: RillValue[] = [];
    for (const [name, mountConfig] of Object.entries(config.mounts)) {
      result.push({
        name,
        mode: mountConfig.mode,
        schema: mountConfig.schema ? 'declared' : 'open',
        maxEntries: mountConfig.maxEntries ?? 10000,
        maxValueSize: mountConfig.maxValueSize ?? 102400,
        prefix: mountConfig.prefix,
        ttl: mountConfig.ttl ?? 0,
      });
    }
    return result;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const fnDict: {
    get: RillFunction; get_or: RillFunction; set: RillFunction; merge: RillFunction;
    delete: RillFunction; keys: RillFunction; has: RillFunction; clear: RillFunction;
    getAll: RillFunction; schema: RillFunction; mounts: RillFunction;
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
      annotations: { description: 'Get value or return fallback if key missing' },
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
      annotations: { description: 'Merge partial dict into existing dict value' },
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
      returnType: structureToTypeValue({ kind: 'list', element: { kind: 'string' } }),
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
      returnType: structureToTypeValue({ kind: 'dict', valueType: { kind: 'any' } }),
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
            prefix: { type: { kind: 'string' } },
            ttl: { type: { kind: 'number' } },
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
