/**
 * Tests for S3 fs extension factory.
 * Validates configuration, S3 client initialization, and function exports.
 */

import { describe, it, expect, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  getStatus,
  isInvalid,
  RuntimeError,
  RuntimeHaltSignal,
  createRuntimeContext,
  execute,
  parse,
  type ApplicationCallable,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createS3FsExtension } from '../src/index.js';
import type { S3FsConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

const BASE_MOUNT = {
  mode: 'read-write',
  bucket: 'test-bucket',
  prefix: '',
} as const;

const TEST_CREDENTIALS = {
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
};

function expectConfigError(config: S3FsConfig, message: string): void {
  let caught: unknown;
  try {
    createS3FsExtension(config, makeFactoryCtx());
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RuntimeError);
  expect((caught as RuntimeError).errorId).toBe('RILL-R001');
  expect((caught as RuntimeError).message).toContain(message);
}

describe('createS3FsExtension', () => {
  describe('configuration validation', () => {
    const REGION_MESSAGE = 'S3 configuration requires non-empty region';
    const MOUNTS_MESSAGE = 'S3 configuration requires at least one mount';
    const ENDPOINT_EMPTY_MESSAGE = 'S3 endpoint must be a non-empty string';

    it.each([
      {
        label: 'missing region',
        config: { mounts: { test: BASE_MOUNT } } as unknown as S3FsConfig,
        message: REGION_MESSAGE,
      },
      {
        label: 'empty region',
        config: { region: '', mounts: { test: BASE_MOUNT } },
        message: REGION_MESSAGE,
      },
      {
        label: 'whitespace-only region',
        config: { region: '   ', mounts: { test: BASE_MOUNT } },
        message: REGION_MESSAGE,
      },
      {
        label: 'missing mounts',
        config: { region: 'us-west-2' } as unknown as S3FsConfig,
        message: MOUNTS_MESSAGE,
      },
      {
        label: 'empty mounts object',
        config: { region: 'us-west-2', mounts: {} },
        message: MOUNTS_MESSAGE,
      },
      {
        label: 'empty endpoint',
        config: {
          region: 'us-west-2',
          endpoint: '',
          mounts: { test: BASE_MOUNT },
        },
        message: ENDPOINT_EMPTY_MESSAGE,
      },
      {
        label: 'whitespace-only endpoint',
        config: {
          region: 'us-west-2',
          endpoint: '   ',
          mounts: { test: BASE_MOUNT },
        },
        message: ENDPOINT_EMPTY_MESSAGE,
      },
      {
        label: 'malformed endpoint URL',
        config: {
          region: 'us-west-2',
          endpoint: 'not-a-url',
          mounts: { test: BASE_MOUNT },
        },
        message: 'S3 endpoint must be a valid URL: not-a-url',
      },
    ])('throws RILL-R001 for $label', ({ config, message }) => {
      expectConfigError(config, message);
    });
  });

  describe('valid configuration acceptance', () => {
    it.each([
      {
        label: 'minimal AWS S3',
        config: {
          region: 'us-west-2',
          credentials: TEST_CREDENTIALS,
          mounts: {
            uploads: {
              mode: 'read-write',
              bucket: 'my-bucket',
              prefix: 'uploads/',
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'uploads',
            mode: 'read-write',
            glob: '',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        ],
      },
      {
        label: 'S3-compatible MinIO',
        config: {
          region: 'us-east-1',
          credentials: {
            accessKeyId: 'minioadmin',
            secretAccessKey: 'minioadmin',
          },
          endpoint: 'http://localhost:9000',
          forcePathStyle: true,
          mounts: { local: BASE_MOUNT },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'local',
            mode: 'read-write',
            glob: '',
            bucket: 'test-bucket',
            prefix: '',
          },
        ],
      },
      {
        label: 'Cloudflare R2',
        config: {
          region: 'auto',
          credentials: {
            accessKeyId: 'r2-key',
            secretAccessKey: 'r2-secret',
          },
          endpoint: 'https://account123.r2.cloudflarestorage.com',
          mounts: {
            storage: {
              mode: 'read-write',
              bucket: 'my-r2-bucket',
              prefix: 'app-data/',
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'storage',
            mode: 'read-write',
            glob: '',
            bucket: 'my-r2-bucket',
            prefix: 'app-data/',
          },
        ],
      },
      {
        label: 'default credential provider chain',
        config: {
          region: 'us-west-2',
          mounts: {
            uploads: {
              mode: 'read-write',
              bucket: 'my-bucket',
              prefix: 'uploads/',
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'uploads',
            mode: 'read-write',
            glob: '',
            bucket: 'my-bucket',
            prefix: 'uploads/',
          },
        ],
      },
      {
        label: 'multiple mounts',
        config: {
          region: 'us-west-2',
          credentials: TEST_CREDENTIALS,
          mounts: {
            uploads: {
              mode: 'read-write',
              bucket: 'uploads-bucket',
              prefix: 'user-files/',
            },
            backups: {
              mode: 'read',
              bucket: 'backups-bucket',
              prefix: 'database/',
            },
            logs: {
              mode: 'write',
              bucket: 'logs-bucket',
              prefix: 'app-logs/',
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'uploads',
            mode: 'read-write',
            glob: '',
            bucket: 'uploads-bucket',
            prefix: 'user-files/',
          },
          {
            name: 'backups',
            mode: 'read',
            glob: '',
            bucket: 'backups-bucket',
            prefix: 'database/',
          },
          {
            name: 'logs',
            mode: 'write',
            glob: '',
            bucket: 'logs-bucket',
            prefix: 'app-logs/',
          },
        ],
      },
      {
        label: 'mount with glob pattern',
        config: {
          region: 'us-west-2',
          credentials: TEST_CREDENTIALS,
          mounts: {
            images: {
              mode: 'read-write',
              bucket: 'assets-bucket',
              prefix: 'images/',
              glob: '*.{jpg,png,gif}',
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'images',
            mode: 'read-write',
            glob: '*.{jpg,png,gif}',
            bucket: 'assets-bucket',
            prefix: 'images/',
          },
        ],
      },
      {
        label: 'mount with custom maxFileSize',
        config: {
          region: 'us-west-2',
          credentials: TEST_CREDENTIALS,
          mounts: {
            uploads: {
              mode: 'read-write',
              bucket: 'uploads-bucket',
              prefix: 'files/',
              maxFileSize: 5242880,
            },
          },
        } satisfies S3FsConfig,
        expected: [
          {
            name: 'uploads',
            mode: 'read-write',
            glob: '',
            bucket: 'uploads-bucket',
            prefix: 'files/',
          },
        ],
      },
    ])(
      'lists the configured mounts for $label',
      async ({ config, expected }) => {
        const ext = createS3FsExtension(config, makeFactoryCtx());
        const v = ext.value as unknown as Record<
          string,
          {
            fn: (
              args: Record<string, unknown>,
              ctx: unknown
            ) => Promise<unknown>;
          }
        >;

        const result = await v['mounts']!.fn({}, makeRuntimeCtx());

        expect(result).toEqual(expected);
        await ext.dispose?.();
      }
    );
  });

  describe('dispose lifecycle', () => {
    function createTestExtension(): ReturnType<typeof createS3FsExtension> {
      return createS3FsExtension(
        {
          region: 'us-west-2',
          credentials: TEST_CREDENTIALS,
          mounts: { test: BASE_MOUNT },
        },
        makeFactoryCtx()
      );
    }

    type HostFn = {
      fn: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
    };

    async function captureThrown(fn: HostFn['fn']): Promise<{
      resolved: boolean;
      thrown: unknown;
      halt: RuntimeHaltSignal | undefined;
    }> {
      try {
        await fn(
          { path: 'test/file.txt', src: 'test/a', dest: 'test/b' },
          makeRuntimeCtx()
        );
        return { resolved: true, thrown: undefined, halt: undefined };
      } catch (e) {
        if (e instanceof RuntimeHaltSignal) {
          return { resolved: false, thrown: e.value, halt: e };
        }
        return { resolved: false, thrown: e, halt: undefined };
      }
    }

    it('throws #DISPOSED with raw.kind extension_disposed from every function', async () => {
      const sendSpy = vi
        .spyOn(S3Client.prototype, 'send')
        .mockResolvedValue({} as never);
      try {
        const ext = createTestExtension();
        const fns = ext.value as unknown as Record<string, HostFn>;
        const names = Object.keys(fns);
        expect(names).toHaveLength(12);

        await expect(ext.dispose?.()).resolves.toBeUndefined();
        for (const name of names) {
          const { resolved, thrown, halt } = await captureThrown(fns[name]!.fn);
          expect(resolved).toBe(false);
          expect(halt).toBeInstanceOf(RuntimeHaltSignal);
          expect(halt?.catchable).toBe(true);
          expect(isInvalid(thrown as RillValue)).toBe(true);
          const status = getStatus(thrown as RillValue);
          expect(status.code.name).toBe('DISPOSED');
          expect(status.raw['kind']).toBe('extension_disposed');
          expect(status.provider).toBe('fs-s3');
        }
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        sendSpy.mockRestore();
      }
    });

    it('resolves on repeated dispose and keeps throwing', async () => {
      const ext = createTestExtension();
      const fns = ext.value as unknown as Record<string, HostFn>;

      await expect(ext.dispose?.()).resolves.toBeUndefined();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
      await expect(ext.dispose?.()).resolves.toBeUndefined();
      const { resolved, thrown } = await captureThrown(fns['read']!.fn);

      expect(resolved).toBe(false);
      expect(getStatus(thrown as RillValue).code.name).toBe('DISPOSED');
    });
  });
});

describe('createS3FsExtension - runtime dispatch after dispose', () => {
  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = createS3FsExtension(
      {
        region: 'us-west-2',
        credentials: TEST_CREDENTIALS,
        mounts: { test: BASE_MOUNT },
      },
      makeFactoryCtx()
    );
    const mounts = (ext.value as Record<string, ApplicationCallable>)[
      'mounts'
    ]!;
    const ctx = createRuntimeContext({
      functions: { mounts },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('mounts()'), ctx).catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const ctx = await mountDisposed();

    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { mounts() }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
