/**
 * Shared test helpers for exec extension.
 */

import {
  createRuntimeContext,
  type ExtensionFactoryCtx,
  type RuntimeContext,
} from '@rcrsr/rill';

export function makeFactoryCtx(signal?: AbortSignal): ExtensionFactoryCtx {
  return {
    signal: signal ?? new AbortController().signal,
    registerErrorCode: () => {},
  };
}

export function makeRuntimeCtx(): RuntimeContext {
  return createRuntimeContext();
}
