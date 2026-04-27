/**
 * Test helpers for the google-workspace package.
 * Factory-context fixture and inspection utilities for the post-rill-0.19
 * invalid-RillValue assertion pattern.
 */

import { expect } from 'vitest';
import {
  isInvalid,
  getStatus,
  type ExtensionFactoryCtx,
  type RillValue,
} from '@rcrsr/rill';

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

export function expectInvalid(
  result: unknown,
  atom: string,
  needle?: string,
): void {
  const value = result as RillValue;
  expect(isInvalid(value)).toBe(true);
  const status = getStatus(value);
  expect(status.code.name).toBe(atom);
  if (needle !== undefined) {
    expect(status.message).toContain(needle);
  }
}
