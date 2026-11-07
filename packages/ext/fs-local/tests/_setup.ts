/**
 * Shared test helpers for fs-local extension.
 */

import {
  createRuntimeContext,
  isApplicationCallable,
  isDict,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
  type RillValue,
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

/** Extract a named ApplicationCallable from an extension result value dict. */
export function getCallable(
  ext: { value: RillValue },
  name: string
): ApplicationCallable {
  const dict = ext.value;
  if (!isDict(dict)) throw new Error('extension value is not a dict');
  const callable = dict[name];
  if (callable === undefined || !isApplicationCallable(callable)) {
    throw new Error(`extension has no application callable "${name}"`);
  }
  return callable;
}
