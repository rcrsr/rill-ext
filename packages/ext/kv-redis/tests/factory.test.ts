/**
 * Tests for Redis kv extension factory.
 *
 * Coverage:
 * - Factory creates extension with valid config
 * - Configuration validation failure
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRedisKvExtension } from '../src/factory.js';
import type { RedisKvExtensionConfig } from '../src/factory.js';
import { makeFactoryCtx } from './_setup.js';

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
});
