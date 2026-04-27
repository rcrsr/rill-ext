/**
 * Shared test helpers for kv-sqlite extension.
 */

import {
  createRuntimeContext,
  type ExtensionFactoryCtx,
  type RuntimeContext,
} from '@rcrsr/rill';

export function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}

export function makeRuntimeCtx(): RuntimeContext {
  return createRuntimeContext();
}
