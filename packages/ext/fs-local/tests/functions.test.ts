/**
 * Host function tests for the local filesystem extension.
 *
 * Tests all 12 filesystem operations with mount-prefixed path sandboxing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuntimeError } from '@rcrsr/rill';
import { createLocalFsExtension } from '../src/factory.js';
import type { FsLocalExtensionConfig } from '../src/types.js';

// Helper to extract the callable dict from the extension value
type CallableDict = Record<string, {
  fn: (args: Record<string, unknown>) => Promise<unknown>;
  params: unknown[];
  annotations?: Record<string, unknown>;
  returnType?: unknown;
}>;

async function makeExt(config: FsLocalExtensionConfig): Promise<CallableDict> {
  const ext = await createLocalFsExtension(config);
  return ext.value as unknown as CallableDict;
}

describe('fs-local extension functions', () => {
  let tempDir: string;
  let testMount: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-fs-local-test-'));
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

  // ============================================================
  // READ
  // ============================================================

  describe('read', () => {
    it('reads file contents', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'test.txt'), 'hello world', 'utf-8');

      const result = await ext['read']!.fn({ path: '/workspace/test.txt' });
      expect(result).toBe('hello world');
    });

    it('reads UTF-8 content with special characters', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const content = 'Hello 世界 🌍';
      await fs.writeFile(path.join(testMount, 'unicode.txt'), content, 'utf-8');

      const result = await ext['read']!.fn({ path: '/workspace/unicode.txt' });
      expect(result).toBe(content);
    });

    it('throws RuntimeError when file not found (RILL-R004)', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      try {
        await ext['read']!.fn({ path: '/workspace/nonexistent.txt' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toContain('file not found');
      }
    });

    it('throws RuntimeError when file exceeds size limit', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
        maxFileSize: 100,
      });

      await fs.writeFile(path.join(testMount, 'large.txt'), 'x'.repeat(200), 'utf-8');

      try {
        await ext['read']!.fn({ path: '/workspace/large.txt' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
        expect((error as RuntimeError).message).toContain('exceeds size limit');
      }
    });

    it('respects per-mount maxFileSize override', async () => {
      const ext = await makeExt({
        mounts: {
          workspace: { path: testMount, mode: 'read-write', maxFileSize: 50 },
        },
        maxFileSize: 1000,
      });

      await fs.writeFile(path.join(testMount, 'test.txt'), 'x'.repeat(60), 'utf-8');

      await expect(
        ext['read']!.fn({ path: '/workspace/test.txt' })
      ).rejects.toBeInstanceOf(RuntimeError);
    });
  });

  // ============================================================
  // WRITE
  // ============================================================

  describe('write', () => {
    it('writes file contents', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const bytesWritten = await ext['write']!.fn({
        path: '/workspace/output.txt',
        content: 'test content',
      });

      expect(bytesWritten).toBe('12');
      const content = await fs.readFile(path.join(testMount, 'output.txt'), 'utf-8');
      expect(content).toBe('test content');
    });

    it('replaces existing file', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'replace.txt'), 'old content', 'utf-8');
      await ext['write']!.fn({ path: '/workspace/replace.txt', content: 'new content' });

      const content = await fs.readFile(path.join(testMount, 'replace.txt'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('returns bytes written as string', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const result = await ext['write']!.fn({
        path: '/workspace/bytes.txt',
        content: 'Hello 世界',
      });

      // "Hello 世界" is 12 bytes in UTF-8
      expect(result).toBe('12');
    });

    it('throws RuntimeError when content exceeds size limit', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
        maxFileSize: 50,
      });

      await expect(
        ext['write']!.fn({ path: '/workspace/large.txt', content: 'x'.repeat(100) })
      ).rejects.toBeInstanceOf(RuntimeError);
    });
  });

  // ============================================================
  // APPEND
  // ============================================================

  describe('append', () => {
    it('appends content to existing file', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'append.txt'), 'line1\n', 'utf-8');
      await ext['append']!.fn({ path: '/workspace/append.txt', content: 'line2\n' });

      const content = await fs.readFile(path.join(testMount, 'append.txt'), 'utf-8');
      expect(content).toBe('line1\nline2\n');
    });

    it('creates new file if not exists', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await ext['append']!.fn({ path: '/workspace/new.txt', content: 'content' });

      const content = await fs.readFile(path.join(testMount, 'new.txt'), 'utf-8');
      expect(content).toBe('content');
    });

    it('returns bytes appended as string', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const result = await ext['append']!.fn({
        path: '/workspace/log.txt',
        content: 'new entry',
      });

      expect(result).toBe('9');
    });

    it('throws RuntimeError when total size exceeds limit', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
        maxFileSize: 100,
      });

      await fs.writeFile(path.join(testMount, 'growing.txt'), 'x'.repeat(80), 'utf-8');

      await expect(
        ext['append']!.fn({ path: '/workspace/growing.txt', content: 'x'.repeat(30) })
      ).rejects.toBeInstanceOf(RuntimeError);
    });
  });

  // ============================================================
  // LIST
  // ============================================================

  describe('list', () => {
    it('lists directory contents with correct shape', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.writeFile(path.join(testMount, 'file1.txt'), 'content', 'utf-8');
      await fs.writeFile(path.join(testMount, 'file2.txt'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'subdir'));

      const result = await ext['list']!.fn({ path: '/workspace' }) as Array<Record<string, unknown>>;

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);

      const file1 = result.find((item) => item['name'] === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1).toMatchObject({ name: 'file1.txt', type: 'file', size: expect.any(Number) });

      const subdir = result.find((item) => item['name'] === 'subdir');
      expect(subdir).toMatchObject({ name: 'subdir', type: 'directory' });
    });

    it('lists subdirectory contents', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.mkdir(path.join(testMount, 'subdir'));
      await fs.writeFile(path.join(testMount, 'subdir', 'nested.txt'), 'data', 'utf-8');

      const result = await ext['list']!.fn({ path: '/workspace/subdir' }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'nested.txt', type: 'file' });
    });
  });

  // ============================================================
  // FIND
  // ============================================================

  describe('find', () => {
    it('recursively finds all files with default pattern', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.writeFile(path.join(testMount, 'root.txt'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'dir1'));
      await fs.writeFile(path.join(testMount, 'dir1', 'nested.txt'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'dir1', 'dir2'));
      await fs.writeFile(path.join(testMount, 'dir1', 'dir2', 'deep.txt'), 'data', 'utf-8');

      const result = await ext['find']!.fn({ path: '/workspace' }) as string[];

      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('root.txt');
      expect(result).toContain(path.join('dir1', 'nested.txt'));
      expect(result).toContain(path.join('dir1', 'dir2', 'deep.txt'));
    });

    it('filters files by glob pattern', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.writeFile(path.join(testMount, 'doc.txt'), 'data', 'utf-8');
      await fs.writeFile(path.join(testMount, 'data.json'), 'data', 'utf-8');
      await fs.mkdir(path.join(testMount, 'subdir'));
      await fs.writeFile(path.join(testMount, 'subdir', 'nested.txt'), 'data', 'utf-8');

      const result = await ext['find']!.fn({ path: '/workspace', pattern: '*.txt' }) as string[];

      expect(result).toContain('doc.txt');
      expect(result).not.toContain('data.json');
      expect(result).toContain(path.join('subdir', 'nested.txt'));
    });
  });

  // ============================================================
  // EXISTS
  // ============================================================

  describe('exists', () => {
    it('returns true when file exists', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.writeFile(path.join(testMount, 'exists.txt'), 'data', 'utf-8');

      const result = await ext['exists']!.fn({ path: '/workspace/exists.txt' });
      expect(result).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      const result = await ext['exists']!.fn({ path: '/workspace/missing.txt' });
      expect(result).toBe(false);
    });

    it('returns false for path traversal attempts', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      const result = await ext['exists']!.fn({ path: '/workspace/../../etc/passwd' });
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // REMOVE
  // ============================================================

  describe('remove', () => {
    it('deletes existing file and returns true', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'todelete.txt'), 'data', 'utf-8');

      const result = await ext['remove']!.fn({ path: '/workspace/todelete.txt' });
      expect(result).toBe(true);

      await expect(fs.stat(path.join(testMount, 'todelete.txt'))).rejects.toThrow();
    });

    it('returns false when file does not exist', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const result = await ext['remove']!.fn({ path: '/workspace/nonexistent.txt' });
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // STAT
  // ============================================================

  describe('stat', () => {
    it('returns metadata for existing file', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.writeFile(path.join(testMount, 'info.txt'), 'hello', 'utf-8');

      const result = await ext['stat']!.fn({ path: '/workspace/info.txt' }) as Record<string, unknown>;

      expect(result['name']).toBe('info.txt');
      expect(result['type']).toBe('file');
      expect(typeof result['size']).toBe('number');
      expect(typeof result['created']).toBe('string');
      expect(typeof result['modified']).toBe('string');
    });

    it('throws RuntimeError when file not found', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      try {
        await ext['stat']!.fn({ path: '/workspace/missing.txt' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
      }
    });

    it('returns metadata for directory', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read' } },
      });

      await fs.mkdir(path.join(testMount, 'mydir'));

      const result = await ext['stat']!.fn({ path: '/workspace/mydir' }) as Record<string, unknown>;
      expect(result['type']).toBe('directory');
    });
  });

  // ============================================================
  // MKDIR
  // ============================================================

  describe('mkdir', () => {
    it('creates directory and returns true', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const result = await ext['mkdir']!.fn({ path: '/workspace/newdir' });
      expect(result).toBe(true);

      const stats = await fs.stat(path.join(testMount, 'newdir'));
      expect(stats.isDirectory()).toBe(true);
    });

    it('returns false when directory already exists', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.mkdir(path.join(testMount, 'existing'));

      const result = await ext['mkdir']!.fn({ path: '/workspace/existing' });
      expect(result).toBe(false);
    });

    it('creates nested directories recursively', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      const result = await ext['mkdir']!.fn({ path: '/workspace/a/b/c' });
      expect(result).toBe(true);

      const stats = await fs.stat(path.join(testMount, 'a', 'b', 'c'));
      expect(stats.isDirectory()).toBe(true);
    });
  });

  // ============================================================
  // COPY
  // ============================================================

  describe('copy', () => {
    it('copies file within mount', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'src.txt'), 'copy me', 'utf-8');

      const result = await ext['copy']!.fn({
        src: '/workspace/src.txt',
        dest: '/workspace/dest.txt',
      });
      expect(result).toBe(true);

      const content = await fs.readFile(path.join(testMount, 'dest.txt'), 'utf-8');
      expect(content).toBe('copy me');
    });

    it('throws RuntimeError when src and dest are different mounts', async () => {
      const otherMount = path.join(tempDir, 'other');
      await fs.mkdir(otherMount);

      const ext = await makeExt({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
          other: { path: otherMount, mode: 'read-write' },
        },
      });

      await fs.writeFile(path.join(testMount, 'src.txt'), 'data', 'utf-8');

      try {
        await ext['copy']!.fn({ src: '/workspace/src.txt', dest: '/other/dest.txt' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
      }
    });
  });

  // ============================================================
  // MOVE
  // ============================================================

  describe('move', () => {
    it('moves file within mount', async () => {
      const ext = await makeExt({
        mounts: { workspace: { path: testMount, mode: 'read-write' } },
      });

      await fs.writeFile(path.join(testMount, 'original.txt'), 'data', 'utf-8');

      const result = await ext['move']!.fn({
        src: '/workspace/original.txt',
        dest: '/workspace/moved.txt',
      });
      expect(result).toBe(true);

      await expect(fs.stat(path.join(testMount, 'original.txt'))).rejects.toThrow();
      const content = await fs.readFile(path.join(testMount, 'moved.txt'), 'utf-8');
      expect(content).toBe('data');
    });

    it('throws RuntimeError when src and dest are different mounts', async () => {
      const otherMount = path.join(tempDir, 'other');
      await fs.mkdir(otherMount);

      const ext = await makeExt({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
          other: { path: otherMount, mode: 'read-write' },
        },
      });

      await fs.writeFile(path.join(testMount, 'src.txt'), 'data', 'utf-8');

      try {
        await ext['move']!.fn({ src: '/workspace/src.txt', dest: '/other/dest.txt' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeError);
        expect((error as RuntimeError).errorId).toBe('RILL-R004');
      }
    });
  });

  // ============================================================
  // MOUNTS
  // ============================================================

  describe('mounts', () => {
    it('returns list of configured mounts', async () => {
      const ext = await makeExt({
        mounts: {
          workspace: { path: testMount, mode: 'read-write' },
        },
      });

      const result = await ext['mounts']!.fn({}) as Array<Record<string, unknown>>;

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'workspace',
        mode: 'read-write',
        glob: '',
      });
    });

    it('returns glob field for mounts with glob configured', async () => {
      const ext = await makeExt({
        mounts: {
          csvonly: { path: testMount, mode: 'read', glob: '*.csv' },
        },
      });

      const result = await ext['mounts']!.fn({}) as Array<Record<string, unknown>>;
      expect(result[0]).toMatchObject({ glob: '*.csv' });
    });
  });
});
