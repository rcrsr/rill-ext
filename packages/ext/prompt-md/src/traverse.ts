/**
 * Recursive directory traversal for *.prompt.md files.
 *
 * Mirrors the pattern at packages/ext/fs-local/src/factory.ts:255-268.
 * Does NOT import from @rcrsr/rill-ext-fs-local (§EXT.2.1 / GF-20).
 *
 * Does not follow symlinks (readdir default: no followSymlinks option passed).
 * Rejects relative paths containing `..` segments as a security measure.
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ============================================================
// TYPES
// ============================================================

export interface TraversalEntry {
  absolutePath: string;
  /** Path relative to basePath, using the platform separator. */
  relativePath: string;
}

// ============================================================
// TRAVERSE
// ============================================================

/**
 * Recursively collects all `*.prompt.md` files under `basePath`.
 *
 * Does not follow symlinks. Skips any entry whose derived relative path
 * contains a `..` segment (path traversal guard).
 *
 * @param basePath - Absolute path to the directory to scan.
 * @returns Ordered array of `{ absolutePath, relativePath }` pairs.
 */
export async function traversePromptFiles(
  basePath: string
): Promise<TraversalEntry[]> {
  const results: TraversalEntry[] = [];

  const recurse = async (currentPath: string): Promise<void> => {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip symlinks explicitly: isDirectory() returns false for symlinked
      // directories, but symlinked files still match the suffix check below
      // and would otherwise be read even when they point outside basePath.
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await recurse(fullPath);
      } else if (entry.name.endsWith('.prompt.md')) {
        const rel = relative(basePath, fullPath);

        // Security: reject any relative path that traverses upward.
        const segments = rel.split(/[/\\]/);
        if (segments.includes('..')) {
          continue;
        }

        results.push({ absolutePath: fullPath, relativePath: rel });
      }
    }
  };

  await recurse(basePath);
  return results;
}
