/**
 * fs-local Extension Sandbox Module
 *
 * Path resolution and validation implementing 9-step security sequence.
 * Prevents path traversal and symlink attacks via realpath() defense.
 *
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { RuntimeError, type RillValue, type RuntimeContext } from '@rcrsr/rill';
import type { MountConfig } from './types.js';
import { EXT_FS_LOCAL_PATH } from './errors.js';

const PROVIDER = 'fs-local';

// ============================================================
// TYPES
// ============================================================

/** Operation type for mode validation */
export type Operation = 'read' | 'write';

// ============================================================
// PATH RESOLUTION
// ============================================================

/**
 * Resolves and validates path within mount boundaries.
 *
 * 9-step path resolution sequence:
 * 1. Resolve mount name to MountConfig
 * 2. Use mount's resolved physical path (from creation time)
 * 3. Join resolved mount base with script's relative path argument
 * 4. Normalize with path.resolve() to collapse .. segments
 * 5. Resolve final path with fs.realpath() (symlink defense)
 * 6. Verify resolved path starts with mount's resolved base (startsWith())
 * 7. If glob set, verify filename matches pattern
 * 8. Check mode permits operation
 * 9. Return validated path for node:fs operation
 *
 * Returns the validated absolute path string on success, or an invalid
 * RillValue on any sandbox / I/O failure. Use `isInvalid()` from rill to
 * discriminate.
 */
export async function resolvePath(
  mountName: string,
  relativePath: string,
  mounts: Record<string, MountConfig>,
  operation: Operation,
  ctx: RuntimeContext,
  createMode = false,
): Promise<string | RillValue> {
  // Step 1: Resolve mount name to MountConfig
  const mount = mounts[mountName];
  if (!mount) {
    return ctx.invalidate(
      new Error(`mount "${mountName}" not configured`),
      {
        code: EXT_FS_LOCAL_PATH,
        provider: PROVIDER,
        raw: { kind: 'unknown_mount', mountName },
      },
    );
  }

  // Step 2: Use mount's resolved physical path (set at creation time)
  const mountBase = mount.resolvedPath;
  if (!mountBase) {
    return ctx.invalidate(
      new Error(`mount "${mountName}" not initialized (missing resolvedPath)`),
      {
        code: EXT_FS_LOCAL_PATH,
        provider: PROVIDER,
        raw: { kind: 'mount_uninitialized', mountName },
      },
    );
  }

  // Step 3: Join resolved mount base with script's relative path
  const joined = path.join(mountBase, relativePath);

  // Step 4: Normalize with path.resolve() to collapse .. segments
  const normalized = path.resolve(joined);

  // Step 6 (early check): Verify normalized path starts with mount base before realpath
  if (
    !normalized.startsWith(mountBase + path.sep) &&
    normalized !== mountBase
  ) {
    return ctx.invalidate(
      new Error('path escapes mount boundary'),
      {
        code: EXT_FS_LOCAL_PATH,
        provider: PROVIDER,
        raw: {
          kind: 'path_escape',
          mountName,
          path: relativePath,
          normalized,
          mountBase,
        },
      },
    );
  }

  // Step 5: Resolve final path with fs.realpath() (symlink defense)
  let resolvedPath: string;
  try {
    if (createMode) {
      // New file write: resolve parent directory
      const parentDir = path.dirname(normalized);
      const resolvedParent = await fs.realpath(parentDir);
      const filename = path.basename(normalized);
      resolvedPath = path.join(resolvedParent, filename);
    } else {
      // Existing file: resolve full path
      resolvedPath = await fs.realpath(normalized);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'EACCES' || code === 'EPERM') {
        return ctx.invalidate(
          new Error(`permission denied: ${normalized}`),
          {
            code: EXT_FS_LOCAL_PATH,
            provider: PROVIDER,
            raw: { kind: 'permission_denied', path: normalized, code },
          },
        );
      }
      if (code === 'ENOENT') {
        if (createMode) {
          return ctx.invalidate(
            new Error(
              `parent directory does not exist: ${path.dirname(normalized)}`,
            ),
            {
              code: EXT_FS_LOCAL_PATH,
              provider: PROVIDER,
              raw: { kind: 'parent_missing', path: normalized },
            },
          );
        }
        return ctx.invalidate(
          new Error(`file not found: ${normalized}`),
          {
            code: EXT_FS_LOCAL_PATH,
            provider: PROVIDER,
            raw: { kind: 'file_not_found', path: normalized },
          },
        );
      }
    }
    throw error;
  }

  // Step 6 (post-realpath): Verify resolved path still within mount (symlink defense)
  if (
    !resolvedPath.startsWith(mountBase + path.sep) &&
    resolvedPath !== mountBase
  ) {
    return ctx.invalidate(
      new Error('path escapes mount boundary'),
      {
        code: EXT_FS_LOCAL_PATH,
        provider: PROVIDER,
        raw: {
          kind: 'symlink_escape',
          mountName,
          path: relativePath,
          resolvedPath,
          mountBase,
        },
      },
    );
  }

  // Step 7: If glob set, verify filename matches pattern
  if (mount.glob) {
    const filename = path.basename(resolvedPath);
    if (!matchesGlob(filename, mount.glob)) {
      return ctx.invalidate(
        new Error(`file type not permitted in mount "${mountName}"`),
        {
          code: EXT_FS_LOCAL_PATH,
          provider: PROVIDER,
          raw: { kind: 'glob_mismatch', mountName, glob: mount.glob, filename },
        },
      );
    }
  }

  // Step 8: Check mode permits operation
  if (!checkMode(mount.mode, operation)) {
    return ctx.invalidate(
      new Error(`mount "${mountName}" does not permit ${operation}`),
      {
        code: EXT_FS_LOCAL_PATH,
        provider: PROVIDER,
        raw: { kind: 'mode_violation', mountName, mode: mount.mode, operation },
      },
    );
  }

  // Step 9: Return validated path for node:fs operation
  return resolvedPath;
}

// ============================================================
// GLOB MATCHING
// ============================================================

/**
 * Simple glob pattern matching.
 *
 * Supported patterns:
 * - *.csv - Files ending in .csv
 * - *.{json,yaml} - Files ending in .json or .yaml
 * - * - All files (default when omitted)
 * - **\/*.csv - CSV files at any depth (for find() only)
 */
export function matchesGlob(filename: string, pattern: string): boolean {
  // Pattern: * (all files)
  if (pattern === '*') {
    return true;
  }

  // Pattern: *.ext (single extension)
  if (pattern.startsWith('*.') && !pattern.includes('{')) {
    const ext = pattern.slice(1);
    return filename.endsWith(ext);
  }

  // Pattern: *.{ext1,ext2} (multiple extensions)
  if (pattern.startsWith('*.{') && pattern.endsWith('}')) {
    const extensionsStr = pattern.slice(3, -1);
    const extensions = extensionsStr.split(',').map((e) => `.${e.trim()}`);
    return extensions.some((ext) => filename.endsWith(ext));
  }

  // Pattern: **/*.ext (recursive, any depth)
  if (pattern.startsWith('**/')) {
    const subPattern = pattern.slice(3);
    return matchesGlob(filename, subPattern);
  }

  // Unknown pattern: no match (conservative)
  return false;
}

// ============================================================
// MODE VALIDATION
// ============================================================

/**
 * Checks if mount mode permits operation.
 */
export function checkMode(
  mode: 'read' | 'write' | 'read-write',
  operation: Operation,
): boolean {
  if (mode === 'read-write') return true;
  if (mode === 'read' && operation === 'read') return true;
  if (mode === 'write' && operation === 'write') return true;
  return false;
}

// ============================================================
// MOUNT INITIALIZATION
// ============================================================

/**
 * Resolves mount path at creation time.
 *
 * Mutates MountConfig to set resolvedPath field.
 *
 * Throws synchronously (factory-init) — uses RILL-R005 because mounts are
 * configured before any host fn returns. Configuration errors should fail
 * extension creation, not produce invalid RillValues at runtime.
 */
export async function initializeMount(mount: MountConfig): Promise<void> {
  try {
    mount.resolvedPath = await fs.realpath(mount.path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R005',
          `mount path does not exist: ${mount.path}`,
          undefined,
          { path: mount.path },
        );
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new RuntimeError(
          'RILL-R005',
          `permission denied: ${mount.path}`,
          undefined,
          { path: mount.path, code },
        );
      }
    }
    throw error;
  }
}

// ============================================================
// MOUNT PATH PARSING
// ============================================================

/**
 * Parses a mount-prefixed path into mount name and relative path.
 *
 * Uses longest-first prefix matching to support mount names containing slashes.
 * Strips a leading `/` before matching.
 * Example: "/workspace/my/file.txt" → { mountName: "workspace", relativePath: "my/file.txt" }
 *
 * Returns either the parsed result or an invalid RillValue if no mount
 * matches the path prefix.
 */
export function parseMountPath(
  fullPath: string,
  mounts: Record<string, MountConfig>,
  ctx: RuntimeContext,
): { mountName: string; relativePath: string } | RillValue {
  const normalized = fullPath.startsWith('/') ? fullPath.slice(1) : fullPath;
  const sortedNames = Object.keys(mounts).sort((a, b) => b.length - a.length);

  for (const mountName of sortedNames) {
    if (normalized === mountName) {
      return { mountName, relativePath: '' };
    }
    if (normalized.startsWith(mountName + '/')) {
      return {
        mountName,
        relativePath: normalized.slice(mountName.length + 1),
      };
    }
  }

  return ctx.invalidate(
    new Error(`no mount matches path "${fullPath}"`),
    {
      code: EXT_FS_LOCAL_PATH,
      provider: PROVIDER,
      raw: { kind: 'no_mount_match', path: fullPath },
    },
  );
}
