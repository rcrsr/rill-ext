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
        message: expect.stringContaining('mount path does not exist'),
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
