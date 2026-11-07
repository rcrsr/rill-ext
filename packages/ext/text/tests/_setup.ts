/**
 * Shared test helpers for text extension.
 */

import {
  createRuntimeContext,
  type ApplicationCallable,
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

/** Extract a named ApplicationCallable from an ExtensionFactoryResult value dict. */
export function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}
