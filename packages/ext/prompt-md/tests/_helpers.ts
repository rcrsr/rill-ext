/**
 * Test helpers for the prompt-md package.
 * Provides a factory-context fixture for the post-rill-0.19 factory signature.
 */

import { type ExtensionFactoryCtx } from '@rcrsr/rill';

/**
 * Build a no-op ExtensionFactoryCtx for tests. Extensions in this
 * monorepo do not register custom atoms; the generic taxonomy is
 * process-global, so `registerErrorCode` is safe to stub.
 */
export function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}
