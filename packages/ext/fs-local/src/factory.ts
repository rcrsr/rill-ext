/**
 * Factory function for creating local filesystem extension.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RuntimeError,
  getStatus,
  isInvalid,
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { FsExtensionContract } from '@rcrsr/rill-ext-fs-shared';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { FsLocalExtensionConfig, MountConfig } from './types.js';
import {
  resolvePath,
  matchesGlob,
  checkMode,
  initializeMount,
  parseMountPath,
} from './sandbox.js';

const PROVIDER = 'fs-local';

/**
 * Creates a local filesystem extension with sandboxed operations.
 *
 * Initializes all mounts by resolving paths at creation time.
 * Returns 12 functions: read, write, append, list, find, exists, remove, stat, mkdir, copy, move, mounts.
 */
export async function createLocalFsExtension(
  config: FsLocalExtensionConfig,
  _ctx: ExtensionFactoryCtx,
): Promise<ExtensionFactoryResult> {

  // Validate required configuration (factory-init: throw R005)
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new RuntimeError(
      'RILL-R005',
      'fs-local extension requires at least one mount in configuration',
    );
  }

  // Apply defaults
  const maxFileSize = config.maxFileSize ?? 10485760; // 10MB
  const encoding = config.encoding ?? 'utf-8';

  // Initialize all mounts (resolve paths at creation time)
  const mounts: Record<string, MountConfig> = {};
  for (const [name, mountConfig] of Object.entries(config.mounts)) {
    mounts[name] = { ...mountConfig };
  }

  // Initialize mounts in parallel; errors propagate as RILL-R005.
  await Promise.all(Object.values(mounts).map((mount) => initializeMount(mount)));

  // ============================================================
  // HELPERS
  // ============================================================

  const getMaxFileSize = (mountName: string): number => {
    const mount = mounts[mountName];
    return mount?.maxFileSize ?? maxFileSize;
  };

  const checkFileSize = (
    size: number,
    max: number,
    filePath: string,
    runCtx: RuntimeContext,
  ): RillValue | null => {
    if (size > max) {
      return runCtx.invalidate(
        new Error(`file exceeds size limit (${size} > ${max})`),
        {
          code: 'UNAVAILABLE',
          provider: PROVIDER,
          raw: { kind: 'file_too_large', path: filePath, size, max },
        },
      );
    }
    return null;
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  const read: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const resolved = await resolvePath(mountName, filePath, mounts, 'read', runCtx);
    if (isInvalid(resolved as RillValue)) return resolved as RillValue;
    const resolvedPath = resolved as string;

    const stats = await fs.stat(resolvedPath);
    const max = getMaxFileSize(mountName);
    const sizeInvalid = checkFileSize(stats.size, max, resolvedPath, runCtx);
    if (sizeInvalid !== null) return sizeInvalid;

    return await fs.readFile(resolvedPath, encoding);
  };

  const write: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };
    const content = args['content'] as string;

    const resolved = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      runCtx,
      true,
    );
    if (isInvalid(resolved as RillValue)) return resolved as RillValue;
    const resolvedPath = resolved as string;

    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);
    const sizeInvalid = checkFileSize(contentSize, max, resolvedPath, runCtx);
    if (sizeInvalid !== null) return sizeInvalid;

    await fs.writeFile(resolvedPath, content, encoding);
    return String(contentSize);
  };

  const append: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };
    const content = args['content'] as string;

    const resolved = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      runCtx,
      true,
    );
    if (isInvalid(resolved as RillValue)) return resolved as RillValue;
    const resolvedPath = resolved as string;

    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);

    try {
      const stats = await fs.stat(resolvedPath);
      const sizeInvalid = checkFileSize(
        stats.size + contentSize,
        max,
        resolvedPath,
        runCtx,
      );
      if (sizeInvalid !== null) return sizeInvalid;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          const sizeInvalid = checkFileSize(contentSize, max, resolvedPath, runCtx);
          if (sizeInvalid !== null) return sizeInvalid;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    await fs.appendFile(resolvedPath, content, encoding);
    return String(contentSize);
  };

  const list: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: dirPath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const resolved = await resolvePath(mountName, dirPath, mounts, 'read', runCtx);
    if (isInvalid(resolved as RillValue)) return resolved as RillValue;
    const resolvedPath = resolved as string;

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    const result: RillValue[] = [];
    for (const entry of entries) {
      const fullPath = path.join(resolvedPath, entry.name);
      const stats = await fs.stat(fullPath);

      result.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
      });
    }

    return result;
  };

  const find: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: searchBase } = parsed as {
      mountName: string;
      relativePath: string;
    };
    const pattern = (args['pattern'] as string | undefined) ?? '*';

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      return runCtx.invalidate(
        new Error(`mount "${mountName}" not configured`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'mount_uninitialized', mountName },
        },
      );
    }

    let basePath: string;
    if (searchBase) {
      const resolved = await resolvePath(mountName, searchBase, mounts, 'read', runCtx);
      if (isInvalid(resolved as RillValue)) return resolved as RillValue;
      basePath = resolved as string;
    } else {
      basePath = mount.resolvedPath;
    }

    const results: string[] = [];

    const traverse = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (matchesGlob(entry.name, pattern)) {
          const relativePath = path.relative(mount.resolvedPath!, fullPath);
          results.push(relativePath);
        }
      }
    };

    await traverse(basePath);
    return results;
  };

  const exists: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return false;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const resolved = await resolvePath(mountName, filePath, mounts, 'read', runCtx);
    if (isInvalid(resolved as RillValue)) return false;
    return true;
  };

  const remove: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const resolved = await resolvePath(mountName, filePath, mounts, 'write', runCtx);
    if (isInvalid(resolved as RillValue)) {
      // For remove(), file-not-found returns false; mode/path violations propagate.
      const msg = getStatus(resolved as RillValue).message ?? '';
      if (msg.includes('file not found')) return false;
      return resolved as RillValue;
    }
    const resolvedPath = resolved as string;

    try {
      await fs.rm(resolvedPath);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          return false;
        }
      }
      throw error;
    }
  };

  const stat: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: filePath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const resolved = await resolvePath(mountName, filePath, mounts, 'read', runCtx);
    if (isInvalid(resolved as RillValue)) return resolved as RillValue;
    const resolvedPath = resolved as string;

    const stats = await fs.stat(resolvedPath);
    const filename = path.basename(resolvedPath);

    return {
      name: filename,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
    };
  };

  /**
   * Create directory.
   *
   * Security: resolves the nearest existing ancestor through realpath to block
   * symlink escapes. A symlink inside the mount that points outside will be
   * caught by the post-realpath boundary check before any directory is created.
   */
  const mkdir: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const parsed = parseMountPath(args['path'] as string, mounts, runCtx);
    if (isInvalid(parsed as RillValue)) return parsed as RillValue;
    const { mountName, relativePath: dirPath } = parsed as {
      mountName: string;
      relativePath: string;
    };

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      return runCtx.invalidate(
        new Error(`mount "${mountName}" not configured`),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: { kind: 'mount_uninitialized', mountName },
        },
      );
    }

    // Verify write mode before doing any filesystem work.
    if (!checkMode(mount.mode, 'write')) {
      return runCtx.invalidate(
        new Error(`mount "${mountName}" does not permit write`),
        {
          code: 'FORBIDDEN',
          provider: PROVIDER,
          raw: { kind: 'mode_violation', mountName, mode: mount.mode },
        },
      );
    }

    const mountBase = mount.resolvedPath;
    const joined = path.join(mountBase, dirPath);
    const normalized = path.resolve(joined);

    // Pre-realpath boundary check (catches plain path traversal).
    if (
      !normalized.startsWith(mountBase + path.sep) &&
      normalized !== mountBase
    ) {
      return runCtx.invalidate(
        new Error('path escapes mount boundary'),
        {
          code: 'FORBIDDEN',
          provider: PROVIDER,
          raw: {
            kind: 'path_escape',
            mountName,
            path: dirPath,
            normalized,
            mountBase,
          },
        },
      );
    }

    // Walk up to the deepest existing ancestor and resolve it through
    // fs.realpath() to catch symlink escapes. The target directory does not
    // exist yet so we cannot realpath it directly.
    let ancestorNormalized = normalized;
    let resolvedAncestor: string | undefined;
    while (ancestorNormalized !== mountBase) {
      try {
        resolvedAncestor = await fs.realpath(ancestorNormalized);
        break;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code: string }).code === 'ENOENT'
        ) {
          ancestorNormalized = path.dirname(ancestorNormalized);
        } else {
          throw error;
        }
      }
    }
    if (resolvedAncestor === undefined) {
      resolvedAncestor = await fs.realpath(mountBase);
    }

    // Post-realpath boundary check (catches symlinks pointing outside mount).
    if (
      !resolvedAncestor.startsWith(mountBase + path.sep) &&
      resolvedAncestor !== mountBase
    ) {
      return runCtx.invalidate(
        new Error('path escapes mount boundary'),
        {
          code: 'FORBIDDEN',
          provider: PROVIDER,
          raw: {
            kind: 'symlink_escape',
            mountName,
            path: dirPath,
            resolvedAncestor,
            mountBase,
          },
        },
      );
    }

    // Check if target already exists.
    try {
      const stats = await fs.stat(normalized);
      if (stats.isDirectory()) {
        return false;
      }
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    try {
      await fs.mkdir(normalized, { recursive: true });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'EEXIST') {
          return false;
        }
      }
      throw error;
    }
  };

  const copy: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const srcParsed = parseMountPath(args['src'] as string, mounts, runCtx);
    if (isInvalid(srcParsed as RillValue)) return srcParsed as RillValue;
    const { mountName: srcMountName, relativePath: srcPath } = srcParsed as {
      mountName: string;
      relativePath: string;
    };
    const destParsed = parseMountPath(args['dest'] as string, mounts, runCtx);
    if (isInvalid(destParsed as RillValue)) return destParsed as RillValue;
    const { mountName: destMountName, relativePath: destPath } = destParsed as {
      mountName: string;
      relativePath: string;
    };

    if (srcMountName !== destMountName) {
      return runCtx.invalidate(
        new Error('copy requires same mount for src and dest'),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'cross_mount',
            src: args['src'],
            dest: args['dest'],
          },
        },
      );
    }

    const mountName = srcMountName;

    const resolvedSrcVal = await resolvePath(mountName, srcPath, mounts, 'read', runCtx);
    if (isInvalid(resolvedSrcVal as RillValue)) return resolvedSrcVal as RillValue;
    const resolvedSrc = resolvedSrcVal as string;

    const resolvedDestVal = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      runCtx,
      true,
    );
    if (isInvalid(resolvedDestVal as RillValue)) return resolvedDestVal as RillValue;
    const resolvedDest = resolvedDestVal as string;

    const stats = await fs.stat(resolvedSrc);
    const max = getMaxFileSize(mountName);
    const sizeInvalid = checkFileSize(stats.size, max, resolvedDest, runCtx);
    if (sizeInvalid !== null) return sizeInvalid;

    try {
      await fs.copyFile(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          return runCtx.invalidate(
            new Error(`file not found: ${srcPath}`),
            {
              code: 'UNAVAILABLE',
              provider: PROVIDER,
              raw: { kind: 'file_not_found', path: resolvedSrc },
            },
          );
        }
      }
      throw error;
    }
  };

  const move: CallableFn = async (args, ctxIn) => {
    const runCtx = ctxIn as RuntimeContext;
    const srcParsed = parseMountPath(args['src'] as string, mounts, runCtx);
    if (isInvalid(srcParsed as RillValue)) return srcParsed as RillValue;
    const { mountName: srcMountName, relativePath: srcPath } = srcParsed as {
      mountName: string;
      relativePath: string;
    };
    const destParsed = parseMountPath(args['dest'] as string, mounts, runCtx);
    if (isInvalid(destParsed as RillValue)) return destParsed as RillValue;
    const { mountName: destMountName, relativePath: destPath } = destParsed as {
      mountName: string;
      relativePath: string;
    };

    if (srcMountName !== destMountName) {
      return runCtx.invalidate(
        new Error('move requires same mount for src and dest'),
        {
          code: 'INVALID_INPUT',
          provider: PROVIDER,
          raw: {
            kind: 'cross_mount',
            src: args['src'],
            dest: args['dest'],
          },
        },
      );
    }

    const mountName = srcMountName;

    const resolvedSrcVal = await resolvePath(mountName, srcPath, mounts, 'read', runCtx);
    if (isInvalid(resolvedSrcVal as RillValue)) return resolvedSrcVal as RillValue;
    const resolvedSrc = resolvedSrcVal as string;

    const resolvedDestVal = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      runCtx,
      true,
    );
    if (isInvalid(resolvedDestVal as RillValue)) return resolvedDestVal as RillValue;
    const resolvedDest = resolvedDestVal as string;

    try {
      await fs.rename(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          return runCtx.invalidate(
            new Error(`file not found: ${srcPath}`),
            {
              code: 'UNAVAILABLE',
              provider: PROVIDER,
              raw: { kind: 'file_not_found', path: resolvedSrc },
            },
          );
        }
      }
      throw error;
    }
  };

  const mountsList: CallableFn = async () => {
    const result: RillValue[] = [];

    for (const [name, mount] of Object.entries(mounts)) {
      result.push({
        name,
        mode: mount.mode,
        glob: mount.glob ?? '',
      });
    }

    return result;
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  const fnDict: {
    read: RillFunction;
    write: RillFunction;
    append: RillFunction;
    list: RillFunction;
    find: RillFunction;
    exists: RillFunction;
    remove: RillFunction;
    stat: RillFunction;
    mkdir: RillFunction;
    copy: RillFunction;
    move: RillFunction;
    mounts: RillFunction;
  } = {
    read: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
      ],
      fn: read,
      annotations: { description: 'Read file contents' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    write: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
        p.str('content', 'Content to write'),
      ],
      fn: write,
      annotations: { description: 'Write file, replacing if exists' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    append: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
        p.str('content', 'Content to append'),
      ],
      fn: append,
      annotations: { description: 'Append content to file' },
      returnType: structureToTypeValue({ kind: 'string' }),
    },
    list: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description:
              'Mount-prefixed directory path (e.g. "/mount/subdir")',
          },
        },
      ],
      fn: list,
      annotations: { description: 'List directory contents' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            name: { type: { kind: 'string' } },
            type: { type: { kind: 'string' } },
            size: { type: { kind: 'number' } },
          },
        },
      }),
    },
    find: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description:
              'Mount-prefixed base path (e.g. "/mount" or "/mount/subdir")',
          },
        },
        {
          name: 'pattern',
          type: { kind: 'string' },
          defaultValue: '*',
          annotations: { description: 'Glob pattern for filtering' },
        },
      ],
      fn: find,
      annotations: { description: 'Recursive file search' },
      returnType: structureToTypeValue({
        kind: 'list',
        element: { kind: 'string' },
      }),
    },
    exists: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
      ],
      fn: exists,
      annotations: { description: 'Check file existence' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    remove: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
      ],
      fn: remove,
      annotations: { description: 'Delete file' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    stat: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description: 'Mount-prefixed file path (e.g. "/mount/file.txt")',
          },
        },
      ],
      fn: stat,
      annotations: { description: 'Get file metadata' },
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          type: { type: { kind: 'string' } },
          size: { type: { kind: 'number' } },
          created: { type: { kind: 'string' } },
          modified: { type: { kind: 'string' } },
        },
      }),
    },
    mkdir: {
      params: [
        {
          name: 'path',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {
            description:
              'Mount-prefixed directory path (e.g. "/mount/subdir")',
          },
        },
      ],
      fn: mkdir,
      annotations: { description: 'Create directory' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    copy: {
      params: [
        p.str('src', 'Mount-prefixed source path'),
        p.str('dest', 'Mount-prefixed destination path'),
      ],
      fn: copy,
      annotations: { description: 'Copy file within mount' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    move: {
      params: [
        p.str('src', 'Mount-prefixed source path'),
        p.str('dest', 'Mount-prefixed destination path'),
      ],
      fn: move,
      annotations: { description: 'Move file within mount' },
      returnType: structureToTypeValue({ kind: 'bool' }),
    },
    mounts: {
      params: [],
      fn: mountsList,
      annotations: { description: 'List configured mounts' },
      returnType: structureToTypeValue({ kind: 'list' }),
    },
  };

  const callableDict = {
    read: toCallable(fnDict.read),
    write: toCallable(fnDict.write),
    append: toCallable(fnDict.append),
    list: toCallable(fnDict.list),
    find: toCallable(fnDict.find),
    exists: toCallable(fnDict.exists),
    remove: toCallable(fnDict.remove),
    stat: toCallable(fnDict.stat),
    mkdir: toCallable(fnDict.mkdir),
    copy: toCallable(fnDict.copy),
    move: toCallable(fnDict.move),
    mounts: toCallable(fnDict.mounts),
  } satisfies FsExtensionContract;

  const dispose = async (): Promise<void> => {
    // No external resources to release for local filesystem
  };

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
