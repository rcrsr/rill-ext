/**
 * Shared test helpers for datetime extension.
 */

import { expect } from 'vitest';
import {
  type ApplicationCallable,
  type RillValue,
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

/**
 * Extract a named host function from an ExtensionFactoryResult value dict.
 */
export function fnOf(
  ext: { value: RillValue },
  name: string
): ApplicationCallable {
  const callable = (ext.value as Record<string, ApplicationCallable>)[name];
  expect(callable).toBeDefined();
  return callable!;
}
