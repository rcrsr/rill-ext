/**
 * Test helpers for the claude-code package.
 */

import { expect } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
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

/**
 * Run a thunk that may throw an invalid RillValue, and assert the result
 * carries the expected generic atom. Used to replace `.toThrow(message)`
 * patterns where the host fn now throws a ctx.invalidate value.
 */
export function expectInvalidThrow(
  thunk: () => unknown,
  atom: string,
  needle: string
): void {
  let caught: unknown;
  try {
    thunk();
  } catch (err) {
    caught = err;
  }
  expect(isInvalid(caught as RillValue)).toBe(true);
  const status = getStatus(caught as RillValue);
  expect(status.code.name).toBe(atom);
  expect(status.message).toContain(needle);
}
