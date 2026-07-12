/**
 * Test helpers for the mcp package.
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
 * Drop-in replacement for `expect(promise).rejects.toThrow(needle)` when the
 * rejection is an invalid RillValue produced by `ctx.invalidate` (which is
 * a plain object that vitest's toThrow matcher cannot inspect).
 */
export async function expectRejectsInvalid(
  promise: Promise<unknown>,
  needle?: string | RegExp
): Promise<RillValue> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(isInvalid(caught as RillValue)).toBe(true);
  if (needle !== undefined) {
    const message = getStatus(caught as RillValue).message;
    if (needle instanceof RegExp) {
      expect(message).toMatch(needle);
    } else {
      expect(message).toContain(needle);
    }
  }
  return caught as RillValue;
}
