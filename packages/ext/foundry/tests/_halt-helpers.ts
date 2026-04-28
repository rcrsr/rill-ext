/**
 * Test helpers for RuntimeHaltSignal assertions.
 *
 * In rill 0.19, provider errors surface as `RuntimeHaltSignal` carrying an
 * invalid `RillValue` whose status code is a generic atom (`#AUTH`,
 * `#RATE_LIMIT`, etc.). The signal's own `message` is always the literal
 * `"runtime halt"`; the human-readable message lives in
 * `getStatus(signal.value).message`.
 */

import { expect } from 'vitest';
import { RuntimeError, RuntimeHaltSignal, getStatus } from '@rcrsr/rill';

export interface HaltExpectation {
  readonly code?: string;
  readonly message?: string | RegExp | unknown;
  readonly provider?: string;
}

function matchMessage(actual: string, expected: unknown): void {
  if (typeof expected === 'string') {
    expect(actual).toContain(expected);
    return;
  }
  if (expected instanceof RegExp) {
    expect(actual).toMatch(expected);
    return;
  }
  if (
    expected !== null &&
    typeof expected === 'object' &&
    'asymmetricMatch' in expected &&
    typeof (expected as { asymmetricMatch: unknown }).asymmetricMatch === 'function'
  ) {
    const matched = (
      expected as { asymmetricMatch: (v: unknown) => boolean }
    ).asymmetricMatch(actual);
    expect(matched).toBe(true);
    return;
  }
  expect(actual).toEqual(expected);
}

/**
 * Throws a vitest assertion error if the value is not a matching halt.
 * Accepts both `RuntimeHaltSignal` (provider errors) and `RuntimeError`
 * (synchronous validation throws) so tests need not branch on the
 * underlying exception class.
 */
export function expectHalt(error: unknown, opts: HaltExpectation = {}): void {
  if (error instanceof RuntimeHaltSignal) {
    const status = getStatus(error.value);
    if (opts.code !== undefined) expect(status.code.name).toBe(opts.code);
    if (opts.provider !== undefined) expect(status.provider).toBe(opts.provider);
    if (opts.message !== undefined) matchMessage(status.message, opts.message);
    return;
  }
  if (error instanceof RuntimeError) {
    if (opts.message !== undefined) matchMessage(error.message, opts.message);
    return;
  }
  expect(error).toBeInstanceOf(RuntimeHaltSignal);
}

/**
 * Calls the given callable and asserts it threw a halt matching the
 * expectation. Use for synchronous in-fn validation throws (which now
 * surface as `RuntimeHaltSignal` carrying an invalid `RillValue` with a
 * generic atom).
 */
export function expectThrowHalt(
  fn: () => unknown,
  opts: HaltExpectation = {}
): unknown {
  let thrown: unknown;
  let threw = false;
  try {
    fn();
  } catch (error: unknown) {
    thrown = error;
    threw = true;
  }
  if (!threw) {
    throw new Error('expected function to throw');
  }
  expectHalt(thrown, opts);
  return thrown;
}

/**
 * Awaits a rejected promise and asserts the rejection is a halt matching
 * the given expectation.
 */
export async function expectRejectedHalt(
  promise: Promise<unknown>,
  opts: HaltExpectation = {}
): Promise<unknown> {
  const error = await promise.then(
    () => {
      throw new Error('expected promise to reject');
    },
    (err: unknown) => err
  );
  expectHalt(error, opts);
  return error;
}
