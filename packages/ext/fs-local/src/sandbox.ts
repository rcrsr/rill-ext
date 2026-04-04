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
import { RuntimeError } from '@rcrsr/rill';
import type { MountConfig } from './types.js';

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
 * @param mountName - Mount identifier from script
 * @param relativePath - Script-provided path relative to mount
 * @param mounts - Mount configuration map
 * @param operation - Operation type for mode validation
 * @param createMode - For write operations creating new files (checks parent dir)
 * @returns Validated absolute path
 * @throws RuntimeError - EC-1 (unknown mount), EC-2 (path escape), EC-3 (glob), EC-4 (mode), EC-7 (permission)
 */
export async function resolvePath(
  mountName: string,
  relativePath: string,
  mounts: Record<string, MountConfig>,
  operation: Operation,
  createMode = false
): Promise<string> {
  // Step 1: Resolve mount name to MountConfig
  const mount = mounts[mountName];
  if (!mount) {
    throw new RuntimeError(
      'RILL-R004',
      `mount "${mountName}" not configured`,
      undefined,
      { mountName }
    );
  }

  // Step 2: Use mount's resolved physical path (set at creation time)
  const mountBase = mount.resolvedPath;
  if (!mountBase) {
    throw new RuntimeError(
      'RILL-R004',
      `mount "${mountName}" not initialized (missing resolvedPath)`,
      undefined,
      { mountName }
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
    throw new RuntimeError(
      'RILL-R004',
      'path escapes mount boundary',
      undefined,
      { mountName, path: relativePath, normalized, mountBase }
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
        throw new RuntimeError(
          'RILL-R004',
          `permission denied: ${normalized}`,
          undefined,
          { path: normalized, code }
        );
      }
      if (code === 'ENOENT') {
        if (createMode) {
          throw new RuntimeError(
            'RILL-R004',
            `parent directory does not exist: ${path.dirname(normalized)}`,
            undefined,
            { path: normalized }
          );
        } else {
          throw new RuntimeError(
            'RILL-R004',
            `file not found: ${normalized}`,
            undefined,
            { path: normalized }
          );
        }
      }
    }
    throw error;
  }

  // Step 6 (post-realpath): Verify resolved path still within mount (symlink defense)
  if (
    !resolvedPath.startsWith(mountBase + path.sep) &&
    resolvedPath !== mountBase
  ) {
    throw new RuntimeError(
      'RILL-R004',
      'path escapes mount boundary',
      undefined,
      { mountName, path: relativePath, resolvedPath, mountBase }
    );
  }

  // Step 7: If glob set, verify filename matches pattern
  if (mount.glob) {
    const filename = path.basename(resolvedPath);
    if (!matchesGlob(filename, mount.glob)) {
      throw new RuntimeError(
        'RILL-R004',
        `file type not permitted in mount "${mountName}"`,
        undefined,
        { mountName, glob: mount.glob, filename }
      );
    }
  }

  // Step 8: Check mode permits operation
  if (!checkMode(mount.mode, operation)) {
    throw new RuntimeError(
      'RILL-R004',
      `mount "${mountName}" does not permit ${operation}`,
      undefined,
      { mountName, mode: mount.mode, operation }
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
 *
 * @param filename - Filename to match (basename only)
 * @param pattern - Glob pattern
 * @returns true if filename matches pattern
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
 *
 * @param mode - Mount access mode
 * @param operation - Operation type
 * @returns true if operation permitted
 */
export function checkMode(
  mode: 'read' | 'write' | 'read-write',
  operation: Operation
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
 * @param mount - Mount configuration
 * @throws RuntimeError - If mount path invalid or inaccessible
 */
export async function initializeMount(mount: MountConfig): Promise<void> {
  try {
    mount.resolvedPath = await fs.realpath(mount.path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      if (code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R004',
          `mount path does not exist: ${mount.path}`,
          undefined,
          { path: mount.path }
        );
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new RuntimeError(
          'RILL-R004',
          `permission denied: ${mount.path}`,
          undefined,
          { path: mount.path, code }
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
 * @param fullPath - Path with leading `/` and mount prefix
 * @param mounts - Mount configuration map
 * @returns Parsed mount name and relative path
 * @throws RuntimeError - If no mount matches the path prefix
 */
export function parseMountPath(
  fullPath: string,
  mounts: Record<string, MountConfig>
): { mountName: string; relativePath: string } {
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

  throw new RuntimeError(
    'RILL-R004',
    `no mount matches path "${fullPath}"`,
    undefined,
    { path: fullPath }
  );
}
