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

    it('returns a Promise rejecting with DISPOSED from mounts', async () => {
      const ext = createTestExtension();
      const fns = ext.value as unknown as Record<string, HostFn>;
      await ext.dispose?.();

      const pending = fns['mounts']!.fn({}, makeRuntimeCtx());

      expect(pending).toBeInstanceOf(Promise);
      const halt: unknown = await pending.catch((e: unknown) => e);
      expect(halt).toBeInstanceOf(RuntimeHaltSignal);
      const status = getStatus((halt as RuntimeHaltSignal).value);
      expect(status.code.name).toBe('DISPOSED');
      expect(status.raw['kind']).toBe('extension_disposed');
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

    describe('in-flight requests', () => {
      function deferredSend(): {
        spy: { mockRestore: () => void };
        rejectWith: (e: unknown) => void;
      } {
        let rejectFn: (e: unknown) => void = () => {};
        const spy = vi.spyOn(S3Client.prototype, 'send').mockImplementation(
          () =>
            new Promise((_, reject) => {
              rejectFn = reject;
            }) as never
        );
        return { spy, rejectWith: (e) => rejectFn(e) };
      }

      function abortError(): Error {
        return Object.assign(new Error('Request aborted'), {
          name: 'AbortError',
        });
      }

      async function statusOfInFlight(
        name: 'read' | 'append',
        disposeFirst: boolean,
        failure: Error = new Error('socket hang up')
      ): Promise<{
        code: string;
        kind: unknown;
        provider: unknown;
        thrown: boolean;
      }> {
        const { spy, rejectWith } = deferredSend();
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns[name]!.fn(
            { path: 'test/file.txt', content: 'x' },
            makeRuntimeCtx()
          );
          await Promise.resolve();
          if (disposeFirst) await ext.dispose?.();
          rejectWith(failure);
          let result: RillValue;
          let thrown = false;
          try {
            result = (await pending) as RillValue;
          } catch (error: unknown) {
            if (!(error instanceof RuntimeHaltSignal)) throw error;
            result = error.value;
            thrown = true;
          }
          expect(isInvalid(result)).toBe(true);
          const status = getStatus(result);
          return {
            code: status.code.name,
            kind: status.raw['kind'],
            provider: status.provider,
            thrown,
          };
        } finally {
          spy.mockRestore();
        }
      }

      it('throws #DISPOSED when read is aborted by dispose', async () => {
        const status = await statusOfInFlight('read', true, abortError());

        expect(status).toEqual({
          code: 'DISPOSED',
          kind: 'extension_disposed',
          provider: 'fs-s3',
          thrown: true,
        });
      });

      it('returns #UNAVAILABLE when read fails before dispose', async () => {
        const status = await statusOfInFlight('read', false);

        expect(status.code).toBe('UNAVAILABLE');
        expect(status.thrown).toBe(false);
      });

      it('keeps the error code when a non-abort failure settles after dispose', async () => {
        const status = await statusOfInFlight('read', true);

        expect(status.code).toBe('UNAVAILABLE');
        expect(status.thrown).toBe(false);
      });

      it('throws #DISPOSED when append NoSuchKey bypass is aborted after dispose', async () => {
        const noSuchKey = Object.assign(new Error('missing'), {
          name: 'NoSuchKey',
        });
        let calls = 0;
        let rejectPut: (e: unknown) => void = () => {};
        const spy = vi
          .spyOn(S3Client.prototype, 'send')
          .mockImplementation(() => {
            calls += 1;
            if (calls === 1) return Promise.reject(noSuchKey) as never;
            return new Promise((_, reject) => {
              rejectPut = reject;
            }) as never;
          });
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns['append']!.fn(
            { path: 'test/file.txt', content: 'x' },
            makeRuntimeCtx()
          );
          await vi.waitFor(() => expect(calls).toBe(2));
          await ext.dispose?.();
          rejectPut(abortError());
          const thrown: unknown = await pending.then(
            () => {},
            (error: unknown) => error
          );

          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          const status = getStatus((thrown as RuntimeHaltSignal).value);
          expect(status.code.name).toBe('DISPOSED');
          expect(status.raw['kind']).toBe('extension_disposed');
        } finally {
          spy.mockRestore();
        }
      });

      it('aborts the request signal when dispose runs', async () => {
        let seen: AbortSignal | undefined;
        const spy = vi.spyOn(S3Client.prototype, 'send').mockImplementation(((
          _cmd: unknown,
          opts: unknown
        ) => {
          seen = (opts as { abortSignal: AbortSignal }).abortSignal;
          return new Promise(() => {});
        }) as never);
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          void fns['stat']!.fn({ path: 'test/file.txt' }, makeRuntimeCtx());
          await vi.waitFor(() => expect(seen).toBeDefined());
          expect(seen?.aborted).toBe(false);

          await ext.dispose?.();

          expect(seen?.aborted).toBe(true);
        } finally {
          spy.mockRestore();
        }
      });

      it('throws #DISPOSED from exists when the aborted head request fails after dispose', async () => {
        const { spy, rejectWith } = deferredSend();
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns['exists']!.fn(
            { path: 'test/file.txt' },
            makeRuntimeCtx()
          );
          await Promise.resolve();
          await ext.dispose?.();
          rejectWith(abortError());
          const thrown: unknown = await pending.then(
            () => {},
            (error: unknown) => error
          );

          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          const status = getStatus((thrown as RuntimeHaltSignal).value);
          expect(status.code.name).toBe('DISPOSED');
        } finally {
          spy.mockRestore();
        }
      });

      it('returns false from exists when a stale 404 settles after dispose', async () => {
        const { spy, rejectWith } = deferredSend();
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns['exists']!.fn(
            { path: 'test/file.txt' },
            makeRuntimeCtx()
          );
          await Promise.resolve();
          await ext.dispose?.();
          rejectWith(Object.assign(new Error('nf'), { name: 'NotFound' }));

          await expect(pending).resolves.toBe(false);
        } finally {
          spy.mockRestore();
        }
      });
    });

    describe('between steps', () => {
      type Step = (value: unknown) => void;

      async function runDisposedAfterFirstSend(
        name: string
      ): Promise<{ thrown: unknown; commands: string[] }> {
        const commands: string[] = [];
        let release: Step = () => {};
        const spy = vi
          .spyOn(S3Client.prototype, 'send')
          .mockImplementation(((cmd: { constructor: { name: string } }) => {
            commands.push(cmd.constructor.name);
            if (commands.length === 1) {
              return new Promise((resolve) => {
                release = resolve;
              });
            }
            return Promise.resolve({ ContentLength: 1 });
          }) as never);
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns[name]!.fn(
            {
              path: 'test/file.txt',
              content: 'x',
              src: 'test/a',
              dest: 'test/b',
            },
            makeRuntimeCtx()
          );
          await vi.waitFor(() => expect(commands).toHaveLength(1));
          await ext.dispose?.();
          release({
            ContentLength: 1,
            Body: { transformToString: () => Promise.resolve('') },
          });
          const thrown: unknown = await pending.then(
            () => {},
            (error: unknown) => error
          );
          return { thrown, commands };
        } finally {
          spy.mockRestore();
        }
      }

      it.each([
        ['move', ['HeadObjectCommand']],
        ['copy', ['HeadObjectCommand']],
        ['remove', ['HeadObjectCommand']],
        ['read', ['HeadObjectCommand']],
        ['append', ['GetObjectCommand']],
      ])(
        'throws #DISPOSED from %s without sending a second command',
        async (name, expected) => {
          const { thrown, commands } = await runDisposedAfterFirstSend(name);

          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          expect(getStatus((thrown as RuntimeHaltSignal).value).code.name).toBe(
            'DISPOSED'
          );
          expect(commands).toEqual(expected);
        }
      );

      it('skips the delete in move when dispose lands after the copy', async () => {
        const commands: string[] = [];
        let release: Step = () => {};
        const spy = vi
          .spyOn(S3Client.prototype, 'send')
          .mockImplementation(((cmd: { constructor: { name: string } }) => {
            commands.push(cmd.constructor.name);
            if (cmd.constructor.name === 'CopyObjectCommand') {
              return new Promise((resolve) => {
                release = resolve;
              });
            }
            return Promise.resolve({ ContentLength: 1 });
          }) as never);
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns['move']!.fn(
            { src: 'test/a', dest: 'test/b' },
            makeRuntimeCtx()
          );
          await vi.waitFor(() =>
            expect(commands).toContain('CopyObjectCommand')
          );
          await ext.dispose?.();
          release({});
          const thrown: unknown = await pending.then(
            () => {},
            (error: unknown) => error
          );

          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          expect(commands).not.toContain('DeleteObjectCommand');
        } finally {
          spy.mockRestore();
        }
      });

      it('stops paginating find once disposed', async () => {
        const commands: string[] = [];
        let release: Step = () => {};
        const spy = vi
          .spyOn(S3Client.prototype, 'send')
          .mockImplementation(((cmd: { constructor: { name: string } }) => {
            commands.push(cmd.constructor.name);
            return new Promise((resolve) => {
              release = resolve;
            });
          }) as never);
        try {
          const ext = createTestExtension();
          const fns = ext.value as unknown as Record<string, HostFn>;
          const pending = fns['find']!.fn(
            { path: 'test', pattern: '*' },
            makeRuntimeCtx()
          );
          await vi.waitFor(() => expect(commands).toHaveLength(1));
          await ext.dispose?.();
          release({ Contents: [], NextContinuationToken: 'page-2' });
          const thrown: unknown = await pending.then(
            () => {},
            (error: unknown) => error
          );

          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          expect(commands).toHaveLength(1);
        } finally {
          spy.mockRestore();
        }
      });
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
