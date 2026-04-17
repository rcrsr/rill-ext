/**
 * Factory function for creating prompt-md extension.
 *
 * Scans basePath recursively for *.prompt.md files, parses and validates
 * every file before returning, detects collisions, and assembles closures
 * keyed by resolution name.
 *
 * @module
 */

import { stat } from 'node:fs/promises';
import {
  RuntimeError,
  type ApplicationCallable,
  type CallableFn,
  type ExtensionFactoryResult,
  type RillValue,
} from '@rcrsr/rill';
import type { PromptExtensionContract } from '@rcrsr/rill-ext-prompt-shared';
import type { PromptMdExtensionConfig } from './types.js';
import { traversePromptFiles } from './traverse.js';
import { parseFile } from './parseFile.js';
import { buildClosure } from './buildClosure.js';

// ============================================================
// FACTORY
// ============================================================

/**
 * Creates a prompt-md extension from a directory of *.prompt.md files.
 *
 * Behaviour:
 * - Validates config.basePath (EC-6, EC-7).
 * - Scans basePath recursively and parses every file (EC-8 through EC-14
 *   bubble up from parseFile; all errors are RILL-R004).
 * - Detects resolution name collisions across files (EC-15).
 * - Builds ApplicationCallable closures via buildClosure for each prompt.
 * - Returns `{ value: callableDict, dispose }` satisfying ExtensionFactoryResult.
 * - dispose() is idempotent: setting disposed=true and clearing innerDict on
 *   every call (no early return needed).
 * - Closures wrapped with a disposed-check that throws RILL-R004 if invoked
 *   after disposal (FR-PROMPT-10 AC-3).
 *
 * @param config - Extension configuration containing basePath.
 * @returns A fully-loaded ExtensionFactoryResult with one callable per prompt.
 */
export async function createPromptMdExtension(
  config: PromptMdExtensionConfig,
): Promise<ExtensionFactoryResult> {
  // ── EC-6: validate basePath is non-empty ──────────────────────────────────
  if (typeof config.basePath !== 'string' || config.basePath.trim().length === 0) {
    throw new RuntimeError('RILL-R004', 'basePath must be a non-empty string', undefined, {
      config: 'basePath',
    });
  }

  const basePath = config.basePath.trim();

  // ── EC-7: verify basePath exists and is a directory ───────────────────────
  try {
    const info = await stat(basePath);
    if (!info.isDirectory()) {
      throw new RuntimeError('RILL-R004', `basePath "${basePath}" is not a directory`, undefined, {
        path: basePath,
      });
    }
  } catch (err) {
    if (err instanceof RuntimeError) {
      throw err;
    }
    // stat threw — path does not exist or is inaccessible.
    const message = err instanceof Error ? err.message : String(err);
    throw new RuntimeError(
      'RILL-R004',
      `basePath "${basePath}" does not exist or is not accessible: ${message}`,
      undefined,
      { path: basePath },
    );
  }

  // ── Collect *.prompt.md files ─────────────────────────────────────────────
  const entries = await traversePromptFiles(basePath);

  // ── Parse all files (EC-8 through EC-14 propagate as RILL-R004) ──────────
  const parsed = await Promise.all(
    entries.map((entry) => parseFile(entry.absolutePath, entry.relativePath)),
  );

  // ── EC-15: collision detection ────────────────────────────────────────────
  const nameToAbsolutePaths = new Map<string, string[]>();
  for (const prompt of parsed) {
    const existing = nameToAbsolutePaths.get(prompt.name);
    if (existing) {
      existing.push(prompt.path);
    } else {
      nameToAbsolutePaths.set(prompt.name, [prompt.path]);
    }
  }
  for (const [name, paths] of nameToAbsolutePaths) {
    if (paths.length > 1) {
      throw new RuntimeError(
        'RILL-R004',
        `collision: multiple files resolve to the same prompt name "${name}"`,
        undefined,
        { name, paths },
      );
    }
  }

  // ── Disposal flag ─────────────────────────────────────────────────────────
  let disposed = false;

  // ── Build closures and wrap with disposal check ───────────────────────────
  const innerDict: Record<string, ApplicationCallable> = {};

  for (const prompt of parsed) {
    const closure = buildClosure(prompt);
    const name = prompt.name;

    // Wrap the closure fn to check the disposed flag before executing.
    const wrappedFn: CallableFn = (args, ctx, location) => {
      if (disposed) {
        throw new RuntimeError(
          'RILL-R004',
          `prompt-md: extension has been disposed; cannot invoke "${name}"`,
        );
      }
      return closure.fn(args, ctx, location);
    };
    const wrappedClosure: ApplicationCallable = { ...closure, fn: wrappedFn };

    innerDict[name] = wrappedClosure;
  }

  // Apply compile-time contract check (AC-5).
  const callableDict = innerDict satisfies PromptExtensionContract;

  // ── dispose ───────────────────────────────────────────────────────────────
  const dispose = async (): Promise<void> => {
    disposed = true;
    // Clear all closure references to allow GC.
    for (const key of Object.keys(innerDict)) {
      delete innerDict[key];
    }
  };

  // ── Return ────────────────────────────────────────────────────────────────
  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
