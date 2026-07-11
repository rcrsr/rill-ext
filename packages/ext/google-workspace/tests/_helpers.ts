/**
 * Test helpers for the google-workspace package.
 * Factory-context fixture and inspection utilities for the post-rill-0.19
 * invalid-RillValue assertion pattern.
 */

import type { ExtensionFactoryCtx } from '@rcrsr/rill';

/**
 * Build a no-op ExtensionFactoryCtx for tests. Generic atoms are pre-registered
 * by rill core, so `registerErrorCode` is safe to stub.
 */
export function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}
