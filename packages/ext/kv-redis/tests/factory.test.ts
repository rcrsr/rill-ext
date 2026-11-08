/**
 * Tests for Redis kv extension factory.
 *
 * Coverage:
 * - Factory creates extension with valid config
 * - Configuration validation failure
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  getStatus,
  isInvalid,
  RuntimeHaltSignal,
  type RillValue,
} from '@rcrsr/rill';
import { createRedisKvExtension } from '../src/factory.js';
import type { RedisKvExtensionConfig } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

const redisMock = vi.hoisted(() => ({
  on: vi.fn(),
  quit: vi.fn(() => Promise.resolve('OK')),
  disconnect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  exists: vi.fn(),
  mget: vi.fn(),
  eval: vi.fn(),
  pipeline: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn(),
  multi: vi.fn(),
  setex: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(function () {
    return redisMock;
  }),
}));

const validMounts = { test: { mode: 'read-write', prefix: 'test:' } } as const;

describe('createRedisKvExtension', () => {
  // Track created extensions for cleanup
  const extensions: Array<{ dispose?: () => void | Promise<void> }> = [];

  afterEach(async () => {
    // Clean up all created extensions
    for (const ext of extensions) {
      if (ext.dispose) {
        await ext.dispose();
      }
    }
    extensions.length = 0;
  });

  describe('Factory creates extension with valid config', () => {
    it('accepts TLS connection URL with rediss://', () => {
      const config: RedisKvExtensionConfig = {
        url: 'rediss://localhost:6380',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config, makeFactoryCtx());
        extensions.push(result);
      }).not.toThrow();
    });

    it('accepts connection URL with authentication', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://:password@localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config, makeFactoryCtx());
        extensions.push(result);
      }).not.toThrow();
    });

    it('accepts multiple mounts with non-overlapping prefixes', () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          user: {
            mode: 'read-write',
            prefix: 'app:user:',
          },
          cache: {
            mode: 'read-write',
            prefix: 'app:cache:',
          },
          session: {
            mode: 'read-write',
            prefix: 'session:',
          },
        },
      };

      expect(() => {
        const result = createRedisKvExtension(config, makeFactoryCtx());
        extensions.push(result);
      }).not.toThrow();
    });
  });

  describe('Configuration validation failure', () => {
    it.each([
      {
        label: 'empty mounts',
        config: { url: 'redis://localhost:6379', mounts: {} },
      },
      { label: 'undefined mounts', config: { url: 'redis://localhost:6379' } },
    ])('throws for $label', ({ config }) => {
      expect(() =>
        createRedisKvExtension(
          config as RedisKvExtensionConfig,
          makeFactoryCtx()
        )
      ).toThrow(
        'Redis kv extension requires at least one mount in configuration'
      );
    });

    it.each([
      { label: 'empty string', url: '' },
      { label: 'null', url: null },
    ])('throws for missing connection URL ($label)', ({ url }) => {
      expect(() =>
        createRedisKvExtension(
          { url, mounts: validMounts } as unknown as RedisKvExtensionConfig,
          makeFactoryCtx()
        )
      ).toThrow('Redis kv extension requires a valid connection URL');
    });

    it.each([
      { label: 'http', url: 'http://localhost:6379' },
      { label: 'localhost without protocol', url: 'localhost:6379' },
    ])('throws for invalid URL scheme ($label)', ({ url }) => {
      expect(() =>
        createRedisKvExtension({ url, mounts: validMounts }, makeFactoryCtx())
      ).toThrow(
        'Invalid Redis connection URL: must start with redis:// or rediss://'
      );
    });

    it.each([
      {
        label: 'exact match',
        mounts: {
          user1: { mode: 'read-write', prefix: 'app:user:' },
          user2: { mode: 'read-write', prefix: 'app:user:' },
        },
      },
      {
        label: 'one prefix starts with another',
        mounts: {
          app: { mode: 'read-write', prefix: 'app:' },
          user: { mode: 'read-write', prefix: 'app:user:' },
        },
      },
    ] as const)(
      'throws for overlapping mount prefixes ($label)',
      ({ mounts }) => {
        expect(() =>
          createRedisKvExtension(
            { url: 'redis://localhost:6379', mounts },
            makeFactoryCtx()
          )
        ).toThrow('Mount prefix overlap detected');
      }
    );
  });

  describe('Dispose disconnects Redis client', () => {
    it('dispose can be called multiple times', async () => {
      const config: RedisKvExtensionConfig = {
        url: 'redis://localhost:6379',
        mounts: {
          test: {
            mode: 'read-write',
            prefix: 'test:',
          },
        },
      };

      const result = createRedisKvExtension(config, makeFactoryCtx());

      // First dispose
      await result.dispose?.();

      // Second dispose should not throw
      await expect(result.dispose?.()).resolves.toBeUndefined();
    });
  });

  describe('after dispose', () => {
    it('throws #DISPOSED from every host function without touching the client', async () => {
      const result = createRedisKvExtension(
        {
          url: 'redis://localhost:6379',
          mounts: { test: { mode: 'read-write', prefix: 'test:' } },
        },
        makeFactoryCtx()
      );
      await result.dispose?.();
      const callables = result.value as unknown as Record<
        string,
        { fn: (a: Record<string, RillValue>, c: unknown) => unknown }
      >;
      const names = Object.keys(callables);
      expect(names.length).toBeGreaterThan(0);
      for (const m of Object.values(redisMock)) m.mockClear();

      for (const name of names) {
        let threw = false;
        let thrown: unknown;
        let halt: RuntimeHaltSignal | undefined;
        try {
          await callables[name]!.fn(
            {
              mount: 'test',
              key: 'k',
              value: 'v',
              partial: { a: 1 },
              fallback: 'x',
            },
            makeRuntimeCtx()
          );
        } catch (e) {
          threw = true;
          if (e instanceof RuntimeHaltSignal) {
            halt = e;
            thrown = e.value;
          } else {
            thrown = e;
          }
        }

        expect(threw).toBe(true);
        expect(halt).toBeInstanceOf(RuntimeHaltSignal);
        expect(halt?.catchable).toBe(true);
        expect(isInvalid(thrown as RillValue)).toBe(true);
        const status = getStatus(thrown as RillValue);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.raw['kind']).toBe('extension_disposed');
        expect(status.provider).toBe('kv-redis');
      }
      for (const m of [
        redisMock.get,
        redisMock.set,
        redisMock.del,
        redisMock.scan,
        redisMock.exists,
        redisMock.mget,
        redisMock.eval,
        redisMock.pipeline,
      ]) {
        expect(m).not.toHaveBeenCalled();
      }
    });
  });

  describe('in-flight calls', () => {
    type HostFn = {
      fn: (a: Record<string, RillValue>, c: unknown) => Promise<RillValue>;
    };

    function mount(): {
      result: ReturnType<typeof createRedisKvExtension>;
      fns: Record<string, HostFn>;
    } {
      const result = createRedisKvExtension(
        {
          url: 'redis://localhost:6379',
          mounts: { test: { mode: 'read-write', prefix: 'test:' } },
        },
        makeFactoryCtx()
      );
      return { result, fns: result.value as unknown as Record<string, HostFn> };
    }

    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (v: T) => void;
      reject: (e: unknown) => void;
    } {
      let resolve: (v: T) => void = () => {};
      let reject: (e: unknown) => void = () => {};
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    async function settle(pending: Promise<RillValue>): Promise<{
      value: RillValue | undefined;
      halt: RuntimeHaltSignal | undefined;
    }> {
      try {
        return { value: await pending, halt: undefined };
      } catch (e) {
        if (e instanceof RuntimeHaltSignal)
          return { value: undefined, halt: e };
        throw e;
      }
    }

    beforeEach(() => {
      for (const m of Object.values(redisMock)) m.mockReset();
    });

    it('disconnects the client instead of quitting on dispose', async () => {
      const { result } = mount();

      await result.dispose?.();

      expect(redisMock.disconnect).toHaveBeenCalledTimes(1);
      expect(redisMock.quit).not.toHaveBeenCalled();
    });

    it('throws #DISPOSED when a command is cut off by the closed connection', async () => {
      const { result, fns } = mount();
      const get = deferred<string | null>();
      redisMock.get.mockReturnValue(get.promise);
      const pending = fns['get']!.fn(
        { mount: 'test', key: 'k' },
        makeRuntimeCtx()
      );
      await result.dispose?.();
      get.reject(new Error('Connection is closed.'));

      const { halt } = await settle(pending);

      expect(halt).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus(halt!.value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
      expect(status.provider).toBe('kv-redis');
    });

    it('throws #DISPOSED when an abort-shaped error settles after dispose', async () => {
      const { result, fns } = mount();
      const get = deferred<string | null>();
      redisMock.get.mockReturnValue(get.promise);
      const pending = fns['get']!.fn(
        { mount: 'test', key: 'k' },
        makeRuntimeCtx()
      );
      await result.dispose?.();
      get.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
    });

    it('keeps the error code when a non-closed failure settles after dispose', async () => {
      const { result, fns } = mount();
      const get = deferred<string | null>();
      redisMock.get.mockReturnValue(get.promise);
      const pending = fns['get']!.fn(
        { mount: 'test', key: 'k' },
        makeRuntimeCtx()
      );
      await result.dispose?.();
      get.reject(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));

      const { value, halt } = await settle(pending);

      expect(halt).toBeUndefined();
      expect(getStatus(value!).code.name).toBe('UNAVAILABLE');
    });

    it('returns an invalid value for a closed-connection error before dispose', async () => {
      const { fns } = mount();
      redisMock.get.mockRejectedValue(new Error('Connection is closed.'));

      const { value, halt } = await settle(
        fns['get']!.fn({ mount: 'test', key: 'k' }, makeRuntimeCtx())
      );

      expect(halt).toBeUndefined();
      expect(getStatus(value!).code.name).toBe('UNAVAILABLE');
    });

    it('skips the delete in clear when dispose lands after the scan', async () => {
      const { result, fns } = mount();
      const scan = deferred<[string, string[]]>();
      redisMock.scan.mockReturnValue(scan.promise);
      const pending = fns['clear']!.fn({ mount: 'test' }, makeRuntimeCtx());
      await result.dispose?.();
      scan.resolve(['0', ['test:a']]);

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('throws #DISPOSED from clear when the defaults pipeline is cut off by dispose', async () => {
      const result = createRedisKvExtension(
        {
          url: 'redis://localhost:6379',
          mounts: {
            test: {
              mode: 'read-write',
              prefix: 'test:',
              schema: { a: { type: 'string', default: 'x' } },
            },
          },
        },
        makeFactoryCtx()
      );
      const fns = result.value as unknown as Record<string, HostFn>;
      const exec = deferred<Array<[Error | null, unknown]>>();
      redisMock.scan.mockResolvedValue(['0', []]);
      redisMock.pipeline.mockReturnValue({
        set: vi.fn(),
        setex: vi.fn(),
        exec: () => exec.promise,
      });
      const pending = fns['clear']!.fn({ mount: 'test' }, makeRuntimeCtx());
      await vi.waitFor(() => expect(redisMock.pipeline).toHaveBeenCalled());
      await result.dispose?.();
      exec.resolve([[new Error('Connection is closed.'), undefined]]);

      const { value, halt } = await settle(pending);

      expect(value).toBeUndefined();
      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
    });

    it('returns an invalid value from clear when a pipeline command fails', async () => {
      const result = createRedisKvExtension(
        {
          url: 'redis://localhost:6379',
          mounts: {
            test: {
              mode: 'read-write',
              prefix: 'test:',
              schema: { a: { type: 'string', default: 'x' } },
            },
          },
        },
        makeFactoryCtx()
      );
      const fns = result.value as unknown as Record<string, HostFn>;
      redisMock.scan.mockResolvedValue(['0', []]);
      redisMock.pipeline.mockReturnValue({
        set: vi.fn(),
        setex: vi.fn(),
        exec: () =>
          Promise.resolve([
            [
              Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
              null,
            ],
          ]),
      });

      const { value, halt } = await settle(
        fns['clear']!.fn({ mount: 'test' }, makeRuntimeCtx())
      );

      expect(halt).toBeUndefined();
      expect(getStatus(value!).code.name).toBe('UNAVAILABLE');
    });

    it('skips the write in set when dispose lands after the existence check', async () => {
      const { result, fns } = mount();
      const exists = deferred<number>();
      redisMock.exists.mockReturnValue(exists.promise);
      const pending = fns['set']!.fn(
        { mount: 'test', key: 'k', value: 'v' },
        makeRuntimeCtx()
      );
      await result.dispose?.();
      exists.resolve(1);

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
      expect(redisMock.set).not.toHaveBeenCalled();
      expect(redisMock.setex).not.toHaveBeenCalled();
    });

    it('skips the transaction in merge when dispose lands after the read', async () => {
      const { result, fns } = mount();
      const get = deferred<string | null>();
      redisMock.watch.mockResolvedValue('OK');
      redisMock.unwatch.mockResolvedValue('OK');
      redisMock.get.mockReturnValue(get.promise);
      const pending = fns['merge']!.fn(
        { mount: 'test', key: 'k', partial: { a: 1 } },
        makeRuntimeCtx()
      );
      await vi.waitFor(() => expect(redisMock.get).toHaveBeenCalled());
      await result.dispose?.();
      get.resolve('{"b":2}');

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
      expect(redisMock.multi).not.toHaveBeenCalled();
    });

    it('skips the read in getAll when dispose lands after the scan', async () => {
      const { result, fns } = mount();
      const scan = deferred<[string, string[]]>();
      redisMock.scan.mockReturnValue(scan.promise);
      const pending = fns['getAll']!.fn({ mount: 'test' }, makeRuntimeCtx());
      await result.dispose?.();
      scan.resolve(['0', ['test:a']]);

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
      expect(redisMock.mget).not.toHaveBeenCalled();
    });

    it('stops scanning once disposed between pages', async () => {
      const { result, fns } = mount();
      const scan = deferred<[string, string[]]>();
      redisMock.scan.mockReturnValue(scan.promise);
      const pending = fns['keys']!.fn({ mount: 'test' }, makeRuntimeCtx());
      await result.dispose?.();
      scan.resolve(['7', ['test:a']]);

      const { halt } = await settle(pending);

      expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
      expect(redisMock.scan).toHaveBeenCalledTimes(1);
    });
  });
});
