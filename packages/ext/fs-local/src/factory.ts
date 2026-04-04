/**
 * Factory function for creating local filesystem extension.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RuntimeError,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type FsExtensionContract,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { FsLocalExtensionConfig, MountConfig } from './types.js';
import {
  resolvePath,
  matchesGlob,
  initializeMount,
  parseMountPath,
} from './sandbox.js';

/**
 * Creates a local filesystem extension with sandboxed operations.
 *
 * Initializes all mounts by resolving paths at creation time.
 * Returns 12 functions: read, write, append, list, find, exists, remove, stat, mkdir, copy, move, mounts.
 *
 * @param config - Mount configuration and defaults
 * @returns ExtensionFactoryResult with 12 filesystem functions
 * @throws Error if mount configuration is missing or invalid
 *
 * @example
 * ```typescript
 * const fsExt = await createLocalFsExtension({
 *   mounts: {
 *     workspace: { path: '/home/user/project', mode: 'read-write' }
 *   }
 * });
 * ```
 */
export async function createLocalFsExtension(
  config: FsLocalExtensionConfig
): Promise<ExtensionFactoryResult> {
  // Validate required configuration
  if (!config.mounts || Object.keys(config.mounts).length === 0) {
    throw new Error(
      'fs-local extension requires at least one mount in configuration'
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

  // Initialize mounts sequentially to propagate errors clearly
  await Promise.all(Object.values(mounts).map((mount) => initializeMount(mount)));

  // ============================================================
  // HELPERS
  // ============================================================

  const getMaxFileSize = (mountName: string): number => {
    const mount = mounts[mountName];
    return mount?.maxFileSize ?? maxFileSize;
  };

  const checkFileSize = (size: number, max: number, filePath: string): void => {
    if (size > max) {
      throw new RuntimeError(
        'RILL-R004',
        `file exceeds size limit (${size} > ${max})`,
        undefined,
        { path: filePath, size, max }
      );
    }
  };

  // ============================================================
  // FUNCTIONS
  // ============================================================

  /**
   * Read file contents.
   */
  const read = async (args: Record<string, RillValue>): Promise<string> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'read');
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw new RuntimeError(
          'RILL-R004',
          `file not found: ${filePath}`,
          undefined,
          { path: filePath }
        );
      }
      throw error;
    }

    const stats = await fs.stat(resolvedPath);
    const max = getMaxFileSize(mountName);
    checkFileSize(stats.size, max, resolvedPath);

    return await fs.readFile(resolvedPath, encoding);
  };

  /**
   * Write file contents, replacing if exists.
   */
  const write = async (args: Record<string, RillValue>): Promise<string> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const content = args['content'] as string;

    const resolvedPath = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      true
    );

    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);
    checkFileSize(contentSize, max, resolvedPath);

    await fs.writeFile(resolvedPath, content, encoding);

    return String(contentSize);
  };

  /**
   * Append content to file.
   */
  const append = async (args: Record<string, RillValue>): Promise<string> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const content = args['content'] as string;

    const resolvedPath = await resolvePath(
      mountName,
      filePath,
      mounts,
      'write',
      true
    );

    const contentSize = Buffer.byteLength(content, encoding);
    const max = getMaxFileSize(mountName);

    try {
      const stats = await fs.stat(resolvedPath);
      checkFileSize(stats.size + contentSize, max, resolvedPath);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          checkFileSize(contentSize, max, resolvedPath);
        } else {
          throw error;
        }
      } else if (error instanceof RuntimeError) {
        throw error;
      } else {
        throw error;
      }
    }

    await fs.appendFile(resolvedPath, content, encoding);

    return String(contentSize);
  };

  /**
   * List directory contents.
   */
  const list = async (args: Record<string, RillValue>): Promise<RillValue[]> => {
    const { mountName, relativePath: dirPath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    const resolvedPath = await resolvePath(mountName, dirPath, mounts, 'read');

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

  /**
   * Recursive file search with optional glob pattern.
   */
  const find = async (args: Record<string, RillValue>): Promise<RillValue[]> => {
    const { mountName, relativePath: searchBase } = parseMountPath(
      args['path'] as string,
      mounts
    );
    const pattern = (args['pattern'] as string | undefined) ?? '*';

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      throw new RuntimeError(
        'RILL-R004',
        `mount "${mountName}" not configured`,
        undefined,
        { mountName }
      );
    }

    let basePath: string;
    if (searchBase) {
      basePath = await resolvePath(mountName, searchBase, mounts, 'read');
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

  /**
   * Check file existence.
   */
  const exists = async (args: Record<string, RillValue>): Promise<boolean> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    try {
      await resolvePath(mountName, filePath, mounts, 'read');
      return true;
    } catch (error) {
      if (error instanceof RuntimeError) {
        return false;
      }
      throw error;
    }
  };

  /**
   * Delete file.
   */
  const remove = async (args: Record<string, RillValue>): Promise<boolean> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'write');
    } catch (error) {
      if (error instanceof RuntimeError) {
        return false;
      }
      throw error;
    }

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

  /**
   * Get file metadata.
   */
  const stat = async (
    args: Record<string, RillValue>
  ): Promise<Record<string, RillValue>> => {
    const { mountName, relativePath: filePath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    let resolvedPath: string;
    try {
      resolvedPath = await resolvePath(mountName, filePath, mounts, 'read');
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw new RuntimeError(
          'RILL-R004',
          `file not found: ${filePath}`,
          undefined,
          { path: filePath }
        );
      }
      throw error;
    }

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
   */
  const mkdir = async (args: Record<string, RillValue>): Promise<boolean> => {
    const { mountName, relativePath: dirPath } = parseMountPath(
      args['path'] as string,
      mounts
    );

    const mount = mounts[mountName];
    if (!mount || !mount.resolvedPath) {
      throw new RuntimeError(
        'RILL-R004',
        `mount "${mountName}" not configured`,
        undefined,
        { mountName }
      );
    }

    const mountBase = mount.resolvedPath;
    const joined = path.join(mountBase, dirPath);
    const normalized = path.resolve(joined);

    if (
      !normalized.startsWith(mountBase + path.sep) &&
      normalized !== mountBase
    ) {
      throw new RuntimeError(
        'RILL-R004',
        'path escapes mount boundary',
        undefined,
        { mountName, path: dirPath, normalized, mountBase }
      );
    }

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

  /**
   * Copy file within mount.
   */
  const copy = async (args: Record<string, RillValue>): Promise<boolean> => {
    const { mountName: srcMountName, relativePath: srcPath } = parseMountPath(
      args['src'] as string,
      mounts
    );
    const { mountName: destMountName, relativePath: destPath } = parseMountPath(
      args['dest'] as string,
      mounts
    );

    if (srcMountName !== destMountName) {
      throw new RuntimeError(
        'RILL-R004',
        'copy requires same mount for src and dest',
        undefined,
        { src: args['src'], dest: args['dest'] }
      );
    }

    const mountName = srcMountName;

    const resolvedSrc = await resolvePath(mountName, srcPath, mounts, 'read');
    const resolvedDest = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      true
    );

    const stats = await fs.stat(resolvedSrc);
    const max = getMaxFileSize(mountName);
    checkFileSize(stats.size, max, resolvedDest);

    try {
      await fs.copyFile(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          throw new RuntimeError(
            'RILL-R004',
            `file not found: ${srcPath}`,
            undefined,
            { path: resolvedSrc }
          );
        }
      }
      throw error;
    }
  };

  /**
   * Move file within mount.
   */
  const move = async (args: Record<string, RillValue>): Promise<boolean> => {
    const { mountName: srcMountName, relativePath: srcPath } = parseMountPath(
      args['src'] as string,
      mounts
    );
    const { mountName: destMountName, relativePath: destPath } = parseMountPath(
      args['dest'] as string,
      mounts
    );

    if (srcMountName !== destMountName) {
      throw new RuntimeError(
        'RILL-R004',
        'move requires same mount for src and dest',
        undefined,
        { src: args['src'], dest: args['dest'] }
      );
    }

    const mountName = srcMountName;

    const resolvedSrc = await resolvePath(mountName, srcPath, mounts, 'read');
    const resolvedDest = await resolvePath(
      mountName,
      destPath,
      mounts,
      'write',
      true
    );

    try {
      await fs.rename(resolvedSrc, resolvedDest);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as { code: string }).code === 'ENOENT') {
          throw new RuntimeError(
            'RILL-R004',
            `file not found: ${srcPath}`,
            undefined,
            { path: resolvedSrc }
          );
        }
      }
      throw error;
    }
  };

  /**
   * List configured mounts.
   */
  const mountsList = async (): Promise<RillValue[]> => {
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

  return { value: callableDict as unknown as RillValue, dispose } satisfies ExtensionFactoryResult;
}
