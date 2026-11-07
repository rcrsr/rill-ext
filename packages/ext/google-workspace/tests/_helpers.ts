/**
 * Test helpers for the google-workspace package.
 * Factory-context fixture and inspection utilities for the post-rill-0.19
 * invalid-RillValue assertion pattern.
 */

import { expect, vi } from 'vitest';
import {
  createRuntimeContext,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
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

/**
 * Assert that a callable hands fetch a signal combining the extension's
 * in-flight controller with a 30s timeout.
 *
 * Disposes the extension from inside the fetch mock: the captured signal must
 * be live beforehand and aborted afterwards, which a bare `new AbortController`
 * signal that ignores dispose would not satisfy.
 */
export async function expectCombinedFetchSignal(
  ext: ExtensionFactoryResult,
  callable: ApplicationCallable,
  args: Record<string, RillValue>,
  response: Record<string, unknown>
): Promise<void> {
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
  let captured: AbortSignal | undefined;
  let abortedBeforeDispose: boolean | undefined;

  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: unknown, init: RequestInit) => {
      captured = init.signal as AbortSignal;
      abortedBeforeDispose = captured.aborted;
      await ext.dispose?.();
      return response;
    })
  );

  try {
    await callable.fn(args, createRuntimeContext());
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(abortedBeforeDispose).toBe(false);
    expect(captured?.aborted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    timeoutSpy.mockRestore();
  }
}
