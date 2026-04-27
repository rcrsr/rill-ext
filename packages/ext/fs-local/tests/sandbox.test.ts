/**
 * Sandbox security tests for the local filesystem extension.
 *
 * Tests path resolution, validation, and security enforcement.
 * Covers all error contracts: EC-1 through EC-7.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RuntimeError, getStatus, isInvalid, type RillValue } from '@rcrsr/rill';
import {
  resolvePath,
  matchesGlob,
  checkMode,
  initializeMount,
} from '../src/sandbox.js';
import type { MountConfig } from '../src/types.js';
import { makeRuntimeCtx } from './_setup.js';

let tempDir: string;
let mounts: Record<string, MountConfig>;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rill-sandbox-test-'));

  await fs.mkdir(path.join(tempDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'readonly'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'writeonly'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'csv_only'), { recursive: true });

  await fs.writeFile(path.join(tempDir, 'data', 'test.txt'), 'content');
  await fs.writeFile(path.join(tempDir, 'data', 'test.csv'), 'csv,data');
  await fs.writeFile(path.join(tempDir, 'readonly', 'file.txt'), 'readonly');
  await fs.writeFile(path.join(tempDir, 'csv_only', 'data.csv'), 'csv');
  await fs.writeFile(path.join(tempDir, 'csv_only', 'data.json'), '{}');

  await fs.mkdir(path.join(tempDir, 'data', 'subdir'), { recursive: true });
  await fs.writeFile(path.join(tempDir, 'data', 'subdir', 'nested.txt'), 'nested');

  mounts = {
    data: {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
      resolvedPath: await fs.realpath(path.join(tempDir, 'data')),
    },
    readonly: {
      path: path.join(tempDir, 'readonly'),
      mode: 'read',
      resolvedPath: await fs.realpath(path.join(tempDir, 'readonly')),
    },
    writeonly: {
      path: path.join(tempDir, 'writeonly'),
      mode: 'write',
      resolvedPath: await fs.realpath(path.join(tempDir, 'writeonly')),
    },
    csv_only: {
      path: path.join(tempDir, 'csv_only'),
      mode: 'read-write',
      glob: '*.csv',
      resolvedPath: await fs.realpath(path.join(tempDir, 'csv_only')),
    },
    json_yaml: {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
      glob: '*.{json,yaml}',
      resolvedPath: await fs.realpath(path.join(tempDir, 'data')),
    },
  };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ============================================================
// PATH RESOLUTION SEQUENCE
// ============================================================

describe('resolvePath - 9-step path resolution sequence', () => {
  it('resolves simple path within mount', async () => {
    const resolved = await resolvePath('data', 'test.txt', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('resolves nested path with subdirectories', async () => {
    const resolved = await resolvePath('data', 'subdir/nested.txt', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'data', 'subdir', 'nested.txt'));
  });

  it('collapses .. segments with path.resolve()', async () => {
    const resolved = await resolvePath('data', 'subdir/../test.txt', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('resolves path for write operation (existing file)', async () => {
    const resolved = await resolvePath('data', 'test.txt', mounts, 'write', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });

  it('handles createMode for new file write', async () => {
    const resolved = await resolvePath('data', 'newfile.txt', mounts, 'write', makeRuntimeCtx(), true);
    expect(resolved).toBe(path.join(tempDir, 'data', 'newfile.txt'));
  });
});

// ============================================================
// EC-1: UNKNOWN MOUNT NAME
// ============================================================

describe('resolvePath - EC-1: unknown mount name', () => {
  it('returns invalid for unknown mount', async () => {
    const result = await resolvePath('unknown', 'file.txt', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    const status = getStatus(result as RillValue);
    expect(status.code.name).toBe('R001');
    expect(status.message).toMatch(/mount "unknown" not configured/);
  });
});

// ============================================================
// EC-2: PATH ESCAPES BOUNDARY
// ============================================================

describe('resolvePath - EC-2: path escapes mount boundary', () => {
  it('returns invalid for path traversal with ..', async () => {
    const result = await resolvePath('data', '../../etc/passwd', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
  });

  it('returns invalid with proper message', async () => {
    const result = await resolvePath('data', '../../../outside.txt', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(/path escapes mount boundary/);
  });
});

// ============================================================
// EC-3: GLOB MISMATCH
// ============================================================

describe('resolvePath - EC-3: glob mismatch', () => {
  it('allows matching file extension', async () => {
    const resolved = await resolvePath('csv_only', 'data.csv', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'csv_only', 'data.csv'));
  });

  it('returns invalid for non-matching extension', async () => {
    const result = await resolvePath('csv_only', 'data.json', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(
      /file type not permitted in mount "csv_only"/,
    );
  });
});

// ============================================================
// EC-4: MODE VIOLATION
// ============================================================

describe('resolvePath - EC-4: mode violation', () => {
  it('allows read on read-only mount', async () => {
    const resolved = await resolvePath('readonly', 'file.txt', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'readonly', 'file.txt'));
  });

  it('returns invalid for write to read-only mount', async () => {
    const result = await resolvePath('readonly', 'file.txt', mounts, 'write', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(
      /mount "readonly" does not permit write/,
    );
  });

  it('returns invalid for read from write-only mount', async () => {
    await fs.writeFile(path.join(tempDir, 'writeonly', 'file.txt'), 'data');
    const result = await resolvePath('writeonly', 'file.txt', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(
      /mount "writeonly" does not permit read/,
    );
  });

  it('allows both read and write on read-write mount', async () => {
    const readResolved = await resolvePath('data', 'test.txt', mounts, 'read', makeRuntimeCtx());
    expect(readResolved).toBe(path.join(tempDir, 'data', 'test.txt'));

    const writeResolved = await resolvePath('data', 'test.txt', mounts, 'write', makeRuntimeCtx());
    expect(writeResolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });
});

// ============================================================
// EC-7: PERMISSION / NOT FOUND
// ============================================================

describe('resolvePath - EC-7: permission denied / not found', () => {
  it('returns invalid for non-existent file in read mode', async () => {
    const result = await resolvePath('data', 'nonexistent.txt', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(/file not found/);
  });

  it('returns invalid for missing parent directory in createMode', async () => {
    const result = await resolvePath(
      'data',
      'missing_dir/newfile.txt',
      mounts,
      'write',
      makeRuntimeCtx(),
      true,
    );
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(/parent directory does not exist/);
  });
});

// ============================================================
// SYMLINK DEFENSE
// ============================================================

describe('resolvePath - symlink cannot escape sandbox', () => {
  it('detects symlink pointing outside mount', async () => {
    const symlinkPath = path.join(tempDir, 'data', 'escape_link');
    const outsidePath = path.join(tempDir, 'outside.txt');
    await fs.writeFile(outsidePath, 'escape');
    await fs.symlink(outsidePath, symlinkPath);

    const result = await resolvePath('data', 'escape_link', mounts, 'read', makeRuntimeCtx());
    expect(isInvalid(result as RillValue)).toBe(true);
    expect(getStatus(result as RillValue).message).toMatch(/path escapes mount boundary/);
  });

  it('allows symlink pointing inside mount', async () => {
    const symlinkPath = path.join(tempDir, 'data', 'internal_link');
    const targetPath = path.join(tempDir, 'data', 'test.txt');
    await fs.symlink(targetPath, symlinkPath);

    const resolved = await resolvePath('data', 'internal_link', mounts, 'read', makeRuntimeCtx());
    expect(resolved).toBe(path.join(tempDir, 'data', 'test.txt'));
  });
});

// ============================================================
// GLOB MATCHING
// ============================================================

describe('matchesGlob - glob pattern matching', () => {
  it('matches * (all files)', () => {
    expect(matchesGlob('any.txt', '*')).toBe(true);
    expect(matchesGlob('file.csv', '*')).toBe(true);
    expect(matchesGlob('no_extension', '*')).toBe(true);
  });

  it('matches *.ext (single extension)', () => {
    expect(matchesGlob('data.csv', '*.csv')).toBe(true);
    expect(matchesGlob('file.txt', '*.txt')).toBe(true);
    expect(matchesGlob('data.json', '*.csv')).toBe(false);
  });

  it('matches *.{ext1,ext2} (multiple extensions)', () => {
    expect(matchesGlob('config.json', '*.{json,yaml}')).toBe(true);
    expect(matchesGlob('config.yaml', '*.{json,yaml}')).toBe(true);
    expect(matchesGlob('config.yml', '*.{json,yaml}')).toBe(false);
    expect(matchesGlob('config.txt', '*.{json,yaml}')).toBe(false);
  });

  it('matches **/*.ext (recursive, any depth)', () => {
    expect(matchesGlob('data.csv', '**/*.csv')).toBe(true);
    expect(matchesGlob('nested.csv', '**/*.csv')).toBe(true);
    expect(matchesGlob('data.json', '**/*.csv')).toBe(false);
  });

  it('returns false for unknown pattern', () => {
    expect(matchesGlob('file.txt', 'complex[pattern]')).toBe(false);
    expect(matchesGlob('file.txt', '??.txt')).toBe(false);
  });
});

// ============================================================
// MODE VALIDATION
// ============================================================

describe('checkMode - mode validation', () => {
  it('allows read on read mode', () => {
    expect(checkMode('read', 'read')).toBe(true);
  });

  it('denies write on read mode', () => {
    expect(checkMode('read', 'write')).toBe(false);
  });

  it('allows write on write mode', () => {
    expect(checkMode('write', 'write')).toBe(true);
  });

  it('denies read on write mode', () => {
    expect(checkMode('write', 'read')).toBe(false);
  });

  it('allows both operations on read-write mode', () => {
    expect(checkMode('read-write', 'read')).toBe(true);
    expect(checkMode('read-write', 'write')).toBe(true);
  });
});

// ============================================================
// MOUNT INITIALIZATION
// ============================================================

describe('initializeMount - mount initialization', () => {
  it('resolves mount path with fs.realpath()', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'data'),
      mode: 'read-write',
    };

    await initializeMount(mount);

    expect(mount.resolvedPath).toBeDefined();
    expect(mount.resolvedPath).toBe(await fs.realpath(mount.path));
  });

  it('throws RuntimeError for non-existent mount path', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'nonexistent'),
      mode: 'read-write',
    };

    await expect(initializeMount(mount)).rejects.toThrow(RuntimeError);
    await expect(initializeMount(mount)).rejects.toThrow('mount path does not exist');
  });

  it('throws RILL-R005 error code for non-existent path', async () => {
    const mount: MountConfig = {
      path: path.join(tempDir, 'nonexistent'),
      mode: 'read-write',
    };

    try {
      await initializeMount(mount);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).errorId).toBe('RILL-R005');
    }
  });
});
