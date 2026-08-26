/**
 * Test helpers for the claude-code package.
 */

import { expect } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
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
 * Shape of a single host function on the extension value, as seen from tests.
 */
interface HostFn {
  fn: (args: Record<string, unknown>, ctx: RuntimeContext | null) => unknown;
  params: unknown;
  annotations: unknown;
  returnType: unknown;
}

/**
 * The extension value returned by createClaudeCodeExtension, viewed as its
 * host-function map for test assertions.
 */
export interface ClaudeCodeExtValue {
  prompt: HostFn;
  skill: HostFn;
  command: HostFn;
}

/**
 * Narrow an ExtensionFactoryResult's opaque RillValue to its host-function map.
 */
export function extValue(ext: ExtensionFactoryResult): ClaudeCodeExtValue {
  return ext.value as unknown as ClaudeCodeExtValue;
}

/**
 * One step of a RillStream iteration, as consumed by test stream collectors.
 */
export interface StreamStep {
  done: boolean;
  value?: unknown;
  next: HostFn;
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
