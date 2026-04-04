/**
 * Tests for kv-file extension factory.
 *
 * Verifies factory creation, config normalization, and function structure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFileKvExtension } from '../src/factory.js';

describe('kv-file extension factory', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `rill-kv-file-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    storePath = path.join(tempDir, 'test-store.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('factory creation', () => {
    it('creates ExtensionFactoryResult with 11 functions and dispose', () => {
      const ext = createFileKvExtension({ store: storePath });

      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');

      expect(ext.value).toHaveProperty('get');
      expect(ext.value).toHaveProperty('get_or');
      expect(ext.value).toHaveProperty('set');
      expect(ext.value).toHaveProperty('merge');
      expect(ext.value).toHaveProperty('delete');
      expect(ext.value).toHaveProperty('keys');
      expect(ext.value).toHaveProperty('has');
      expect(ext.value).toHaveProperty('clear');
      expect(ext.value).toHaveProperty('getAll');
      expect(ext.value).toHaveProperty('schema');
      expect(ext.value).toHaveProperty('mounts');
    });

    it('wraps functions as ApplicationCallable', () => {
      const ext = createFileKvExtension({ store: storePath });

      expect(ext.value.get).toMatchObject({
        __type: 'callable',
        kind: 'application',
        params: expect.any(Array),
        fn: expect.any(Function),
        returnType: expect.objectContaining({ __rill_type: true }),
      });
    });

    it('throws when neither mounts nor store provided', () => {
      expect(() => createFileKvExtension({})).toThrow(
        'KV file extension requires either "mounts" or "store" configuration',
      );
    });

    it('accepts mount-based config', () => {
      const ext = createFileKvExtension({
        mounts: {
          user: { mode: 'read-write', store: storePath },
        },
      });
      expect(ext).toBeDefined();
    });

    it('accepts legacy single-store config', () => {
      const ext = createFileKvExtension({ store: storePath });
      expect(ext).toBeDefined();
    });
  });
});
