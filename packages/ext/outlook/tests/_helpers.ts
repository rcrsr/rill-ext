/**
 * Test helpers for the outlook package.
 * Provides a factory-context fixture and a small inspection utility for
 * the post-rill-0.19 invalid-RillValue assertion pattern.
 */

import { expect } from 'vitest';
import {
  isInvalid,
  getStatus,
  type ExtensionFactoryCtx,
  type RillValue,
} from '@rcrsr/rill';

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

/**
 * Assert that a host function call resolved to an invalid RillValue
 * carrying the expected generic atom name and message substring.
 */
export function expectInvalid(
  result: unknown,
  atom: string,
  needle: string,
): void {
  const value = result as RillValue;
  expect(isInvalid(value)).toBe(true);
  const status = getStatus(value);
  expect(status.code.name).toBe(atom);
  expect(status.message).toContain(needle);
}
