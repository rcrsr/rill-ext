/**
 * Token resolution for Google Workspace authentication.
 * Implements IR-21: resolveToken with TTL cache for service-account mode.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import type { GoogleAuth, ServiceAccountKey } from '../types.js';
import { failAuth } from '../errors.js';
import { signServiceAccountJwt } from './jwt.js';
import { exchangeJwtForToken } from './exchange.js';

// ============================================================
// TOKEN CACHE
// ============================================================

/**
 * Cached access token slot with millisecond expiry timestamp.
 * expiresAtMs = Date.now() + (expires_in - 300) * 1000 (AC-10).
 */
export interface TokenCacheSlot {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/**
 * Mutable container for a single cached access token slot.
 * Passed in from the factory closure so it lives for the extension lifecycle.
 * Cleared on dispose() (AC-10).
 */
export interface TokenCache {
  slot: TokenCacheSlot | null;
}

/**
 * Create a new empty token cache.
 * One cache per extension instance; scoped to the factory closure.
 */
export function createTokenCache(): TokenCache {
  return { slot: null };
}

/**
 * Clear the token cache (called on dispose).
 * Idempotent: safe to call multiple times (AC-10).
 */
export function clearTokenCache(cache: TokenCache): void {
  cache.slot = null;
}

// ============================================================
// TOKEN RESOLUTION
// ============================================================

/**
 * Resolve the Bearer token for Google API requests (IR-21).
 *
 * - bearer: returns auth.token directly (no I/O)
 * - session: reads auth.tokenVar from RuntimeContext parent chain (EC-21)
 * - service-account: uses TTL cache; on miss/expiry signs JWT and exchanges
 *   for an access token, caching with TTL = expires_in - 300 s (AC-10, BC-6, BC-7)
 *
 * IR-21 specifies the public shape as (auth, ctx) => Promise<string>.
 * The additional `cache`, `scopes`, and `signal` parameters are required
 * for the service-account flow and are supplied by the factory closure.
 * The factory binds these to produce the (auth, ctx) => Promise<string>
 * closure described in the spec. [SPEC]
 *
 * @param auth - Validated GoogleAuth discriminated union
 * @param ctx - RuntimeContext for session variable lookup
 * @param cache - Factory-scoped token cache (cleared on dispose)
 * @param scopes - OAuth2 scopes for service-account JWT; ignored for other modes
 * @param signal - AbortSignal for token exchange HTTP request cancellation
 * @returns Resolved Bearer token string
 * @throws RuntimeError (RILL-R004) if session token variable not found (EC-21)
 * @throws RuntimeError (RILL-R004) on JWT signing or token exchange failure
 */
export async function resolveToken(
  auth: GoogleAuth,
  ctx: RuntimeContext,
  cache: TokenCache,
  scopes: string[],
  signal: AbortSignal
): Promise<string> {
  // --- bearer: return static token directly ---
  if (auth.type === 'bearer') {
    return auth.token;
  }

  // --- session: walk context parent chain to find tokenVar ---
  if (auth.type === 'session') {
    const tokenVar = auth.tokenVar;
    let scope: RuntimeContext | undefined = ctx;

    while (scope !== undefined) {
      const value = scope.variables.get(tokenVar);
      if (value !== undefined) {
        return String(value);
      }
      scope = scope.parent;
    }

    // EC-21: session token variable not found
    failAuth(
      ctx,
      'session_token_missing',
      `google: session token '${tokenVar}' not found`,
      { tokenVar },
    );
  }

  // --- service-account: check TTL cache, sign JWT and exchange on miss ---

  // BC-6: cache hit within TTL — reuse without signing or exchange
  if (cache.slot !== null && cache.slot.expiresAtMs > Date.now()) {
    return cache.slot.accessToken;
  }

  // BC-7: cache miss or TTL expired — re-sign and re-exchange
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(auth.keyJson) as ServiceAccountKey;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failAuth(
      ctx,
      'service_account_key_invalid',
      `google: service account key parse failed: ${reason}`,
    );
  }

  const assertion = signServiceAccountJwt(ctx, key, scopes, auth.subject);
  const { accessToken, expiresIn } = await exchangeJwtForToken(ctx, assertion, signal);

  // AC-10: cache with TTL = expires_in - 300 seconds
  cache.slot = {
    accessToken,
    expiresAtMs: Date.now() + (expiresIn - 300) * 1000,
  };

  return accessToken;
}
