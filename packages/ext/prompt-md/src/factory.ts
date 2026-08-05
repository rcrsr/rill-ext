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
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillValue,
  type RuntimeContext,
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
 * Factory-time validation failures throw `RuntimeError('RILL-R001', ...)`.
 * Closure-runtime failures invalidate the call via `ctx.invalidate` using
 * generic atoms (`#DISPOSED`, `#PROTOCOL`).
 *
 * @param config - Extension configuration containing basePath.
 * @param _ctx - Factory context (unused; closure has no in-flight work).
 * @returns A fully-loaded ExtensionFactoryResult with one callable per prompt.
 */
export async function createPromptMdExtension(
  config: PromptMdExtensionConfig,
  _ctx: ExtensionFactoryCtx
): Promise<ExtensionFactoryResult> {
  // ── validate basePath is non-empty ────────────────────────────────────────
  if (
    typeof config.basePath !== 'string' ||
    config.basePath.trim().length === 0
  ) {
    throw new RuntimeError(
      'RILL-R001',
      'prompt-md: basePath must be a non-empty string',
      undefined,
      {
        config: 'basePath',
      }
    );
  }

  const basePath = config.basePath.trim();

  // ── verify basePath exists and is a directory ─────────────────────────────
  try {
    const info = await stat(basePath);
    if (!info.isDirectory()) {
      throw new RuntimeError(
        'RILL-R001',
        `prompt-md: basePath "${basePath}" is not a directory`,
        undefined,
        {
          path: basePath,
        }
      );
    }
  } catch (err) {
    if (err instanceof RuntimeError) {
      throw err;
    }
    // stat threw — path does not exist or is inaccessible.
    const message = err instanceof Error ? err.message : String(err);
    throw new RuntimeError(
      'RILL-R001',
      `prompt-md: basePath "${basePath}" does not exist or is not accessible: ${message}`,
      undefined,
      { path: basePath }
    );
  }

  // ── Collect *.prompt.md files ─────────────────────────────────────────────
  const entries = await traversePromptFiles(basePath);

  // ── Parse all files (errors propagate as RILL-R001) ───────────────────────
  const parsed = await Promise.all(
    entries.map((entry) => parseFile(entry.absolutePath, entry.relativePath))
  );

  // ── collision detection ───────────────────────────────────────────────────
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
        'RILL-R001',
        `prompt-md: collision: multiple files resolve to the same prompt name "${name}"`,
        undefined,
        { name, paths }
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
    const wrappedFn: CallableFn = (args, ctxLike, location) => {
      if (disposed) {
        const ctx = ctxLike as RuntimeContext;
        throw ctx.invalidate(
          new Error(
            `prompt-md: extension has been disposed; cannot invoke "${name}"`
          ),
          {
            code: 'DISPOSED',
            provider: 'prompt-md',
            raw: { kind: 'disposed', name },
          }
        ) as unknown as RillValue;
      }
      return closure.fn(args, ctxLike, location);
    };
    const wrappedClosure: ApplicationCallable = { ...closure, fn: wrappedFn };

    innerDict[name] = wrappedClosure;
  }

  // Apply compile-time contract check.
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
