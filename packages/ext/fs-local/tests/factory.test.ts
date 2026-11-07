/**
 * Factory tests for the local filesystem extension.
 *
 * Tests config validation and extension shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getStatus, isInvalid, RuntimeError } from '@rcrsr/rill';
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
});
