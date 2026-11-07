/**
 * Test helpers for the outlook package.
 * Provides a factory-context fixture and a small inspection utility for
 * the post-rill-0.19 invalid-RillValue assertion pattern.
 */

import type { Mock } from 'vitest';
import type { ExtensionFactoryCtx } from '@rcrsr/rill';

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

/** Decoded view of one recorded fetch call. */
export interface RecordedRequestDef {
  url: string;
  method: string | undefined;
  body: unknown;
}

/** Decode the nth call recorded by a fetch mock into url, method and parsed JSON body. */
export function recordedRequest(
  mock: Mock<typeof fetch>,
  index = 0
): RecordedRequestDef {
  const call = mock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`no fetch call recorded at index ${index}`);
  }
  const [input, init] = call;
  const rawBody = init?.body;
  return {
    url:
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    method: init?.method,
    body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
  };
}
