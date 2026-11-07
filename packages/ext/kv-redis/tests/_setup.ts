/**
 * Shared test helpers for kv-redis extension.
 */

import { Redis } from 'ioredis';
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
 * Any non-empty value other than 0 enables this; CI sets RILL_EXT_REQUIRE_SERVICES=1 so a missing service cannot pass as a skip.
 */
export function assertServiceAvailable(
  service: string,
  available: boolean
): void {
  const required = process.env['RILL_EXT_REQUIRE_SERVICES'];
  if (
    !available &&
    required !== undefined &&
    required !== '' &&
    required !== '0'
  ) {
    throw new Error(
      `${service} is required (RILL_EXT_REQUIRE_SERVICES=${required}) but is not reachable`
    );
  }
}

/**
 * Probe a Redis server; resolves false when it cannot be reached.
 */
export async function isRedisAvailable(url: string): Promise<boolean> {
  const client = new Redis(url, {
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}
