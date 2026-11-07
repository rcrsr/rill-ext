/**
 * Integration tests for Redis kv contract functions.
 *
 * Coverage (backend-specific behavior; generic kv operations live in contract.test.ts):
 * - Backend swap produces identical output
 * - Atomic merge without race condition
 * - Unknown mount throws MountError
 * - set validates declared types
 * - keys uses SCAN not KEYS
 * - mounts returns metadata
 * - TTL support for auto-expiring keys
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import { isInvalid, getStatus, type RillValue } from '@rcrsr/rill';
import { createRedisKvExtension } from '../src/factory.js';
import type { RedisKvExtensionConfig } from '../src/factory.js';
import { createFileKvExtension as createKvExtension } from '@rcrsr/rill-ext-kv-file';
import {
  assertServiceAvailable,
  isRedisAvailable,
  makeFactoryCtx,
  makeRuntimeCtx,
} from './_setup.js';

/**
 * Extract a named ApplicationCallable from an ExtensionFactoryResult value dict.
 * Auto-injects a runtime context and converts invalid RillValue results to
 * thrown Errors so existing `.rejects.toThrow(...)` patterns continue to work.
 */
function getCallable(
  ext: { value: unknown },
  name: string
): { fn: (args: Record<string, unknown>) => Promise<unknown> } {
  const value = ext.value as Record<
    string,
    {
      fn: (
        args: Record<string, unknown>,
        ctx: unknown
      ) => unknown | Promise<unknown>;
    }
  >;
  const callable = value[name]!;
  return {
    fn: async (args: Record<string, unknown>) => {
      const result = await callable.fn(args, makeRuntimeCtx());
      if (isInvalid(result as RillValue)) {
        throw new Error(getStatus(result as RillValue).message);
      }
      return result;
    },
  };
}

// Redis test connection
const REDIS_URL = 'redis://localhost:6379';

// Check if Redis is available before running tests
const redisAvailable = await isRedisAvailable(REDIS_URL);

assertServiceAvailable('Redis', redisAvailable);

describe.skipIf(!redisAvailable)('Integration Tests', () => {
  // Track created extensions for cleanup
  const extensions: Array<{ dispose?: () => void | Promise<void> }> = [];

  beforeEach(async () => {
    // Clean up any test keys from previous runs
    const cleanup = createRedisKvExtension(
      {
        url: REDIS_URL,
        mounts: {
          test: { mode: 'read-write', prefix: 'test:' },
        },
      },
      makeFactoryCtx()
    );
    extensions.push(cleanup);
    await getCallable(cleanup, 'clear').fn({ mount: 'test' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Clean up all created extensions
    for (const ext of extensions) {
      if (ext.dispose) {
        await ext.dispose();
      }
    }
    extensions.length = 0;
  });

  describe('set validates declared types', () => {
    it('validates type in declared mode', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          typed: {
            mode: 'read-write',
            prefix: 'test:typed:',
            schema: {
              count: { type: 'number', default: 0 },
            },
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      await expect(
        getCallable(ext, 'set').fn({
          mount: 'typed',
          key: 'count',
          value: 'string',
        })
      ).rejects.toThrow('expects number, got string');
    });
  });

  describe('keys uses SCAN not KEYS', () => {
    it('lists keys with SCAN over the mount prefix and never issues KEYS', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:state:',
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      await getCallable(ext, 'set').fn({
        mount: 'state',
        key: 'key1',
        value: 'value1',
      });

      const scanSpy = vi.spyOn(Redis.prototype, 'scan');
      const keysSpy = vi.spyOn(Redis.prototype, 'keys');

      const keys = await getCallable(ext, 'keys').fn({ mount: 'state' });

      expect(keys).toEqual(['key1']);
      expect(scanSpy).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'test:state:*',
        'COUNT',
        100
      );
      expect(keysSpy).not.toHaveBeenCalled();
    });
  });

  describe('mounts returns metadata', () => {
    it('returns list of mount metadata', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'test:user:',
            schema: {
              name: { type: 'string', default: '' },
            },
            maxEntries: 1000,
            maxValueSize: 5000,
            ttl: 3600,
          },
          cache: {
            mode: 'read',
            prefix: 'test:cache:',
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      const result = await getCallable(ext, 'mounts').fn({});
      expect(result).toHaveLength(2);

      expect(result).toContainEqual({
        name: 'user',
        mode: 'read-write',
        schema: 'declared',
        max_entries: 1000,
        max_value_size: 5000,
        prefix: 'test:user:',
        ttl: 3600,
      });

      expect(result).toContainEqual({
        name: 'cache',
        mode: 'read',
        schema: 'open',
        max_entries: 10000,
        max_value_size: 102400,
        prefix: 'test:cache:',
        ttl: 0,
      });
    });
  });

  describe('TTL support for auto-expiring keys', () => {
    it('sets TTL on keys when configured', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          session: {
            mode: 'read-write',
            prefix: 'test:session:',
            ttl: 60,
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      await getCallable(ext, 'set').fn({
        mount: 'session',
        key: 'token',
        value: 'abc123',
      });

      // Key should exist
      const exists = await getCallable(ext, 'has').fn({
        mount: 'session',
        key: 'token',
      });
      expect(exists).toBe(true);

      // Verify TTL was set via raw Redis client
      const rawClient = new Redis(REDIS_URL);
      const ttl = await rawClient.ttl('test:session:token');
      await rawClient.quit();
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('sets TTL on merged keys when configured', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          session: {
            mode: 'read-write',
            prefix: 'test:session:',
            ttl: 60,
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      await getCallable(ext, 'set').fn({
        mount: 'session',
        key: 'data',
        value: { x: 1 },
      });
      await getCallable(ext, 'merge').fn({
        mount: 'session',
        key: 'data',
        partial: { y: 2 },
      });

      // Verify TTL was set via raw Redis client
      const rawClient = new Redis(REDIS_URL);
      const ttl = await rawClient.ttl('test:session:data');
      await rawClient.quit();
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe('Backend swap produces identical output', () => {
    it('produces identical results for same operations on JSON and Redis backends', async () => {
      // JSON file backend configuration
      const jsonExt = createKvExtension(
        {
          mounts: {
            state: {
              mode: 'read-write',
              store: '/tmp/rill-test-backend-swap.json',
              schema: {
                count: { type: 'number', default: 0 },
                name: { type: 'string', default: 'Guest' },
              },
            },
          },
        },
        makeFactoryCtx()
      );

      // Redis backend configuration (identical schema)
      const redisExt = createRedisKvExtension(
        {
          url: REDIS_URL,
          mounts: {
            state: {
              mode: 'read-write',
              prefix: 'test:backend-swap:',
              schema: {
                count: { type: 'number', default: 0 },
                name: { type: 'string', default: 'Guest' },
              },
            },
          },
        },
        makeFactoryCtx()
      );

      extensions.push(jsonExt, redisExt);

      // Execute identical operations on both backends
      await getCallable(jsonExt, 'set').fn({
        mount: 'state',
        key: 'count',
        value: 42,
      });
      await getCallable(redisExt, 'set').fn({
        mount: 'state',
        key: 'count',
        value: 42,
      });

      await getCallable(jsonExt, 'set').fn({
        mount: 'state',
        key: 'name',
        value: 'Alice',
      });
      await getCallable(redisExt, 'set').fn({
        mount: 'state',
        key: 'name',
        value: 'Alice',
      });

      // Verify identical results
      const jsonCount = await getCallable(jsonExt, 'get').fn({
        mount: 'state',
        key: 'count',
      });
      const redisCount = await getCallable(redisExt, 'get').fn({
        mount: 'state',
        key: 'count',
      });
      expect(jsonCount).toBe(redisCount);
      expect(jsonCount).toBe(42);

      const jsonName = await getCallable(jsonExt, 'get').fn({
        mount: 'state',
        key: 'name',
      });
      const redisName = await getCallable(redisExt, 'get').fn({
        mount: 'state',
        key: 'name',
      });
      expect(jsonName).toBe(redisName);
      expect(jsonName).toBe('Alice');

      // Test keys operation
      const jsonKeys = await getCallable(jsonExt, 'keys').fn({
        mount: 'state',
      });
      const redisKeys = await getCallable(redisExt, 'keys').fn({
        mount: 'state',
      });
      expect((jsonKeys as string[]).sort()).toEqual(
        (redisKeys as string[]).sort()
      );

      // Test getAll operation
      const jsonAll = await getCallable(jsonExt, 'getAll').fn({
        mount: 'state',
      });
      const redisAll = await getCallable(redisExt, 'getAll').fn({
        mount: 'state',
      });
      expect(jsonAll).toEqual(redisAll);

      // Cleanup
      if (jsonExt.dispose) await jsonExt.dispose();
    });

    it('handles merge operations identically across backends', async () => {
      const jsonExt = createKvExtension(
        {
          mounts: {
            config: {
              mode: 'read-write',
              store: '/tmp/rill-test-backend-merge.json',
            },
          },
        },
        makeFactoryCtx()
      );

      const redisExt = createRedisKvExtension(
        {
          url: REDIS_URL,
          mounts: {
            config: {
              mode: 'read-write',
              prefix: 'test:backend-merge:',
            },
          },
        },
        makeFactoryCtx()
      );

      extensions.push(jsonExt, redisExt);

      // Set initial dict
      await getCallable(jsonExt, 'set').fn({
        mount: 'config',
        key: 'settings',
        value: { a: 1, b: 2 },
      });
      await getCallable(redisExt, 'set').fn({
        mount: 'config',
        key: 'settings',
        value: { a: 1, b: 2 },
      });

      // Merge partial dict
      await getCallable(jsonExt, 'merge').fn({
        mount: 'config',
        key: 'settings',
        partial: { b: 3, c: 4 },
      });
      await getCallable(redisExt, 'merge').fn({
        mount: 'config',
        key: 'settings',
        partial: { b: 3, c: 4 },
      });

      // Verify identical results
      const jsonSettings = await getCallable(jsonExt, 'get').fn({
        mount: 'config',
        key: 'settings',
      });
      const redisSettings = await getCallable(redisExt, 'get').fn({
        mount: 'config',
        key: 'settings',
      });
      expect(jsonSettings).toEqual(redisSettings);
      expect(jsonSettings).toEqual({ a: 1, b: 3, c: 4 });

      // Cleanup
      if (jsonExt.dispose) await jsonExt.dispose();
    });
  });

  describe('Atomic merge without race condition', () => {
    it('retries merge on concurrent modification', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          state: {
            mode: 'read-write',
            prefix: 'test:concurrent:',
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      await getCallable(ext, 'set').fn({
        mount: 'state',
        key: 'counter',
        value: { count: 0 },
      });

      const competingClient = new Redis(REDIS_URL);
      const originalGet = Reflect.get(Redis.prototype, 'get') as Redis['get'];
      let competed = false;
      // One-shot: after the first read (WATCH already issued), a competing
      // write lands before EXEC, forcing the merge to retry.
      const getSpy = vi
        .spyOn(Redis.prototype, 'get')
        .mockImplementation(async function (
          this: Redis,
          ...getArgs: Parameters<Redis['get']>
        ) {
          const value = await originalGet.apply(this, getArgs);
          if (!competed) {
            competed = true;
            await competingClient.set(
              'test:concurrent:counter',
              JSON.stringify({ count: 99, competitor: true })
            );
          }
          return value;
        });

      try {
        const mergeResult = await getCallable(ext, 'merge').fn({
          mount: 'state',
          key: 'counter',
          partial: { merged: true },
        });
        const readsDuringMerge = getSpy.mock.calls.length;

        expect(mergeResult).toBe(true);
        expect(readsDuringMerge).toBeGreaterThanOrEqual(2);
      } finally {
        getSpy.mockRestore();
        await competingClient.quit();
      }

      const result = await getCallable(ext, 'get').fn({
        mount: 'state',
        key: 'counter',
      });
      expect(result).toEqual({ count: 99, competitor: true, merged: true });
    });
  });

  describe('Unknown mount throws MountError', () => {
    it('throws MountError for all functions with unknown mount name', async () => {
      const config: RedisKvExtensionConfig = {
        url: REDIS_URL,
        mounts: {
          known: {
            mode: 'read-write',
            prefix: 'test:known:',
          },
        },
      };

      const ext = createRedisKvExtension(config, makeFactoryCtx());
      extensions.push(ext);

      // Test all kv functions throw for unknown mount
      await expect(
        getCallable(ext, 'get').fn({ mount: 'unknown', key: 'key' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'get_or').fn({
          mount: 'unknown',
          key: 'key',
          fallback: 'fallback',
        })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'set').fn({
          mount: 'unknown',
          key: 'key',
          value: 'value',
        })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'merge').fn({
          mount: 'unknown',
          key: 'key',
          partial: {},
        })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'delete').fn({ mount: 'unknown', key: 'key' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'keys').fn({ mount: 'unknown' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'has').fn({ mount: 'unknown', key: 'key' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'clear').fn({ mount: 'unknown' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'getAll').fn({ mount: 'unknown' })
      ).rejects.toThrow(`Mount 'unknown' not found`);

      await expect(
        getCallable(ext, 'schema').fn({ mount: 'unknown' })
      ).rejects.toThrow(`Mount 'unknown' not found`);
    });
  });
});
