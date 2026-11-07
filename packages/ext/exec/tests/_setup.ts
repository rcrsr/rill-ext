/**
 * Shared test helpers for exec extension.
 */

import { expect } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { CommandResult } from '../src/types.js';

export function makeFactoryCtx(signal?: AbortSignal): ExtensionFactoryCtx {
  return {
    signal: signal ?? new AbortController().signal,
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
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Assert the runner result is an invalid value and return its status. */
export function invalidStatus(
  result: CommandResult | RillValue
): ReturnType<typeof getStatus> {
  const value = result as RillValue;
  expect(isInvalid(value)).toBe(true);
  return getStatus(value);
}
