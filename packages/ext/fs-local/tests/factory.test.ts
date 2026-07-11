/**
 * Factory tests for the local filesystem extension.
 *
 * Tests config validation and extension shape.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getStatus } from '@rcrsr/rill';
import { createLocalFsExtension } from '../src/factory.js';
import type { FsLocalExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

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
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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
      await expect(
        createLocalFsExtension(config, makeFactoryCtx())
      ).rejects.toThrow();
    });
  });

  describe('extension shape', () => {
    it('returns all 12 host functions', async () => {
      const ext = await createLocalFsExtension(
        {
          mounts: {
            workspace: { path: testMount, mode: 'read-write' },
          },
        },
        makeFactoryCtx()
      );

      const value = ext.value as Record<string, unknown>;
      expect(value['read']).toBeDefined();
      expect(value['write']).toBeDefined();
      expect(value['append']).toBeDefined();
      expect(value['list']).toBeDefined();
      expect(value['find']).toBeDefined();
      expect(value['exists']).toBeDefined();
      expect(value['remove']).toBeDefined();
      expect(value['stat']).toBeDefined();
      expect(value['mkdir']).toBeDefined();
      expect(value['copy']).toBeDefined();
      expect(value['move']).toBeDefined();
      expect(value['mounts']).toBeDefined();
    });

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

    it('applies default maxFileSize of 10MB', async () => {
      const ext = await createLocalFsExtension(
        {
          mounts: {
            workspace: { path: testMount, mode: 'read-write' },
          },
        },
        makeFactoryCtx()
      );

      const value = ext.value as Record<
        string,
        {
          fn: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
        }
      >;

      // Write content just under 10MB (should succeed)
      const content = 'x'.repeat(10485760 - 100);
      await expect(
        value['write']!.fn(
          { path: '/workspace/large.txt', content },
          makeRuntimeCtx()
        )
      ).resolves.toBeDefined();
    });

    it('applies custom maxFileSize', async () => {
      const ext = await createLocalFsExtension(
        {
          mounts: {
            workspace: { path: testMount, mode: 'read-write' },
          },
          maxFileSize: 1000,
        },
        makeFactoryCtx()
      );

      const value = ext.value as Record<
        string,
        {
          fn: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
        }
      >;
      const content = 'x'.repeat(1001);

      const result = await value['write']!.fn(
        { path: '/workspace/too-large.txt', content },
        makeRuntimeCtx()
      );
      const status = getStatus(result as never);
      expect(status.code.name).toBe('UNAVAILABLE');
      expect(status.message).toMatch(/exceeds size limit/);
    });

    it('exports FsLocalExtensionConfig and MountConfig types', async () => {
      const config: FsLocalExtensionConfig = {
        mounts: {
          test: { path: testMount, mode: 'read' },
        },
      };
      expect(config).toBeDefined();
    });
  });
});
