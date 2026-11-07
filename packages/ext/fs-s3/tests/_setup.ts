/**
 * Shared test helpers for fs-s3 extension.
 */

import {
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
 * Fail the suite at module load when services are required but unreachable.
 * CI sets RILL_EXT_REQUIRE_SERVICES=1 so a missing service cannot pass as a skip.
 */
export function assertServiceAvailable(
  service: string,
  available: boolean
): void {
  if (!available && process.env['RILL_EXT_REQUIRE_SERVICES'] === '1') {
    throw new Error(
      `${service} is required (RILL_EXT_REQUIRE_SERVICES=1) but is not reachable`
    );
  }
}
