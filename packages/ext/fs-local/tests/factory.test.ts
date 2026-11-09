/**
 * Factory tests for the local filesystem extension.
 *
 * Tests config validation and extension shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  RuntimeError,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createLocalFsExtension } from '../src/factory.js';
import type { FsLocalExtensionConfig } from '../src/types.js';
import { getCallable, makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

describe('createLocalFsExtension - factory', () => {
  let tempDir: string;
  let testMount: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'rill-fs-local-factory-')
    );
    testMount = path.join(tempDir, 'workspace');
    await fs.mkdir(testMount, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('config validation', () => {
    it('throws when mounts is empty object', async () => {
      const config: FsLocalExtensionConfig = { mounts: {} };
      await expect(
        createLocalFsExtension(config, makeFactoryCtx())
      ).rejects.toThrow('at least one mount');
    });

    it('throws when mount path does not exist', async () => {
      const config: FsLocalExtensionConfig = {
        mounts: {
          bad: { path: '/nonexistent/path/xyz', mode: 'read' },
        },
      };
      const created = createLocalFsExtension(config, makeFactoryCtx());
      await expect(created).rejects.toBeInstanceOf(RuntimeError);
      await expect(created).rejects.toMatchObject({
        errorId: 'RILL-R001',
        message: expect.stringContaining(
          'mount path does not exist'
        ) as unknown,
      });
    });
  });

  describe('extension shape', () => {
    it('returns a dispose function', async () => {
      const ext = await createLocalFsExtension(
        {
          mounts: {
            workspace: { path: testMount, mode: 'read-write' },
          },
        },
        makeFactoryCtx()
      );

      expect(typeof ext.dispose).toBe('function');
      // dispose is idempotent and no-op for local fs
      await expect(ext.dispose?.()).resolves.toBeUndefined();
    });

    it('accepts a write at the 10MB default limit and rejects one byte over', async () => {
      const ext = await createLocalFsExtension(
        {
          mounts: {
            workspace: { path: testMount, mode: 'read-write' },
          },
        },
        makeFactoryCtx()
      );
      const limit = 10485760;
      const atLimitPath = path.join(testMount, 'at-limit.txt');
      const overLimitPath = path.join(testMount, 'over-limit.txt');

      const atLimit = await getCallable(ext, 'write').fn(
        { path: '/workspace/at-limit.txt', content: 'x'.repeat(limit) },
        makeRuntimeCtx()
      );

      expect(isInvalid(atLimit)).toBe(false);
      expect(atLimit).toBe(String(limit));
      expect((await fs.stat(atLimitPath)).size).toBe(limit);

      const ctx = makeRuntimeCtx();
      const invalidateSpy = vi.spyOn(ctx, 'invalidate');
      const overLimit = await getCallable(ext, 'write').fn(
        { path: '/workspace/over-limit.txt', content: 'x'.repeat(limit + 1) },
        ctx
      );

      expect(isInvalid(overLimit)).toBe(true);
      expect(getStatus(overLimit).code.name).toBe('UNAVAILABLE');
      expect(invalidateSpy.mock.calls[0]![1].raw).toMatchObject({
        kind: 'file_too_large',
        size: limit + 1,
        max: limit,
      });
      await expect(fs.stat(overLimitPath)).rejects.toThrow(/ENOENT/);
    });
  });

  describe('after dispose', () => {
    const captureThrown = async (
      call: () => unknown
    ): Promise<{
      threw: boolean;
      thrown: unknown;
      halt: RuntimeHaltSignal | undefined;
    }> => {
      try {
        await call();
      } catch (e) {
        if (e instanceof RuntimeHaltSignal) {
          return { threw: true, thrown: e.value, halt: e };
        }
        return { threw: true, thrown: e, halt: undefined };
      }
      return { threw: false, thrown: undefined, halt: undefined };
    };

    it('throws #DISPOSED with extension_disposed from every function', async () => {
      const ext = await createLocalFsExtension(
        { mounts: { workspace: { path: testMount, mode: 'read-write' } } },
        makeFactoryCtx()
      );
      await ext.dispose?.();
      await ext.dispose?.();
      const names = Object.keys(ext.value as Record<string, unknown>);
      expect(names).toHaveLength(12);

      for (const name of names) {
        const { threw, thrown, halt } = await captureThrown(() =>
          getCallable(ext, name).fn(
            {
              path: '/workspace/a.txt',
              content: 'x',
              from: '/workspace/a.txt',
              to: '/workspace/b.txt',
            },
            makeRuntimeCtx()
          )
        );

        expect(threw).toBe(true);
        expect(halt).toBeInstanceOf(RuntimeHaltSignal);
        expect(halt?.catchable).toBe(true);
        expect(isInvalid(thrown as never)).toBe(true);
        const status = getStatus(thrown as never);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.raw['kind']).toBe('extension_disposed');
        expect(status.provider).toBe('fs-local');
      }
    });

    it('creates no file when write is called after dispose', async () => {
      const ext = await createLocalFsExtension(
        { mounts: { workspace: { path: testMount, mode: 'read-write' } } },
        makeFactoryCtx()
      );
      await ext.dispose?.();
      const target = path.join(testMount, 'late.txt');

      const { threw } = await captureThrown(() =>
        getCallable(ext, 'write').fn(
          { path: '/workspace/late.txt', content: 'x' },
          makeRuntimeCtx()
        )
      );

      expect(threw).toBe(true);
      await expect(fs.stat(target)).rejects.toThrow(/ENOENT/);
    });

    describe('in-flight calls', () => {
      function mountExt(): Promise<
        Awaited<ReturnType<typeof createLocalFsExtension>>
      > {
        return createLocalFsExtension(
          { mounts: { workspace: { path: testMount, mode: 'read-write' } } },
          makeFactoryCtx()
        );
      }

      /** Holds fs.stat for one path until release() is called. */
      function holdStat(target: string): {
        release: () => void;
        calls: () => number;
      } {
        const realStat = fs.stat.bind(fs);
        let release: () => void = () => {};
        let held = 0;
        vi.spyOn(fs, 'stat').mockImplementation(((p: string, o?: never) => {
          if (p !== target) return realStat(p, o);
          held += 1;
          return new Promise((resolve) => {
            release = () => {
              resolve(realStat(p, o));
            };
          });
        }) as never);
        return { release: () => release(), calls: () => held };
      }

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('writes without the lifetime signal so dispose cannot truncate the file', async () => {
        let seen: { signal?: AbortSignal } | undefined;
        vi.spyOn(fs, 'writeFile').mockImplementation(((
          _p: unknown,
          _d: unknown,
          o: { signal?: AbortSignal }
        ) => {
          seen = o;
          return new Promise(() => {});
        }) as never);
        const ext = await mountExt();
        void getCallable(ext, 'write').fn(
          { path: '/workspace/a.txt', content: 'x' },
          makeRuntimeCtx()
        );
        await vi.waitFor(() => expect(seen).toBeDefined());

        expect(seen?.signal).toBeUndefined();
      });

      it('keeps the original error when a non-abort failure settles after dispose', async () => {
        let rejectRead: (e: unknown) => void = () => {};
        let readStarted = false;
        const realOpen = fs.open.bind(fs);
        // read() goes through a FileHandle; hold its readFile instead.
        vi.spyOn(fs, 'open').mockImplementation(
          async (...args: Parameters<typeof fs.open>) => {
            const handle = await realOpen(...args);
            handle.readFile = (() => {
              readStarted = true;
              return new Promise((_, reject) => {
                rejectRead = reject;
              });
            }) as never;
            return handle;
          }
        );
        await fs.writeFile(path.join(testMount, 'r.txt'), 'x');
        const ext = await mountExt();
        const pending = getCallable(ext, 'read').fn(
          { path: '/workspace/r.txt' },
          makeRuntimeCtx()
        );
        await vi.waitFor(() => expect(readStarted).toBe(true));
        await ext.dispose?.();
        rejectRead(Object.assign(new Error('EIO'), { code: 'EIO' }));

        const { thrown, halt } = await captureThrown(() => pending);

        expect(halt).toBeUndefined();
        expect((thrown as Error).message).toBe('EIO');
      });

      it('throws #DISPOSED from copy without copying when dispose lands mid-call', async () => {
        const src = path.join(testMount, 'src.txt');
        await fs.writeFile(src, 'data');
        const copySpy = vi.spyOn(fs, 'copyFile');
        const held = holdStat(await fs.realpath(src));
        const ext = await mountExt();
        const pending = getCallable(ext, 'copy').fn(
          { src: '/workspace/src.txt', dest: '/workspace/dst.txt' },
          makeRuntimeCtx()
        );
        await vi.waitFor(() => expect(held.calls()).toBe(1));
        await ext.dispose?.();
        held.release();

        const { halt } = await captureThrown(() => pending);

        expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
        expect(copySpy).not.toHaveBeenCalled();
        await expect(fs.stat(path.join(testMount, 'dst.txt'))).rejects.toThrow(
          /ENOENT/
        );
      });

      it('throws #DISPOSED from append without appending when dispose lands mid-call', async () => {
        const target = path.join(testMount, 'log.txt');
        await fs.writeFile(target, 'a');
        const held = holdStat(await fs.realpath(target));
        const ext = await mountExt();
        const pending = getCallable(ext, 'append').fn(
          { path: '/workspace/log.txt', content: 'b' },
          makeRuntimeCtx()
        );
        await vi.waitFor(() => expect(held.calls()).toBe(1));
        await ext.dispose?.();
        held.release();

        const { halt } = await captureThrown(() => pending);

        expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
        expect(await fs.readFile(target, 'utf-8')).toBe('a');
      });

      it('stops listing once disposed between entries', async () => {
        await fs.writeFile(path.join(testMount, 'one.txt'), '1');
        await fs.writeFile(path.join(testMount, 'two.txt'), '2');
        const first = await fs.realpath(path.join(testMount, 'one.txt'));
        const second = await fs.realpath(path.join(testMount, 'two.txt'));
        const realStat = fs.stat.bind(fs);
        let release: () => void = () => {};
        let statted = 0;
        vi.spyOn(fs, 'stat').mockImplementation(((p: string, o?: never) => {
          if (p !== first && p !== second) return realStat(p, o);
          statted += 1;
          return new Promise((resolve) => {
            release = () => {
              resolve(realStat(p, o));
            };
          });
        }) as never);
        const ext = await mountExt();
        const pending = getCallable(ext, 'list').fn(
          { path: '/workspace' },
          makeRuntimeCtx()
        );
        await vi.waitFor(() => expect(statted).toBe(1));
        await ext.dispose?.();
        release();

        const { halt } = await captureThrown(() => pending);

        expect(getStatus(halt!.value).code.name).toBe('DISPOSED');
        expect(statted).toBe(1);
      });
    });
  });
});

describe('createLocalFsExtension - runtime dispatch after dispose', () => {
  let mount: string;

  beforeEach(async () => {
    mount = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-fs-local-rt-'));
  });

  afterEach(async () => {
    await fs.rm(mount, { recursive: true, force: true });
  });

  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = await createLocalFsExtension(
      { mounts: { workspace: { path: mount, mode: 'read-write' } } },
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext({
      functions: { mounts: getCallable(ext, 'mounts') },
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

describe('createLocalFsExtension - post-dispose shape', () => {
  it('returns a Promise rejecting with DISPOSED from mounts', async () => {
    const ext = await createLocalFsExtension(
      { mounts: { workspace: { path: os.tmpdir(), mode: 'read' } } },
      makeFactoryCtx()
    );
    await ext.dispose?.();

    const pending = getCallable(ext, 'mounts').fn({}, makeRuntimeCtx());

    expect(pending).toBeInstanceOf(Promise);
    const halt: unknown = await Promise.resolve(pending).catch(
      (e: unknown) => e
    );
    expect(halt).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((halt as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });
});
