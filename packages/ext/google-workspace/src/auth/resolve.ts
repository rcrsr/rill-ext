/**
 * Token resolution for Google Workspace authentication.
 * Implements resolveToken with TTL cache for service-account mode.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import type { GoogleAuth, ServiceAccountKey } from '../types.js';
import { failAuth } from '../errors.js';
import { signServiceAccountJwt } from './jwt.js';
import { exchangeJwtForToken, exchangeRefreshToken } from './exchange.js';

// ============================================================
// TOKEN CACHE
// ============================================================

/**
 * Cached access token slot with millisecond expiry timestamp.
 * expiresAtMs = Date.now() + (expires_in - 300) * 1000.
 */
interface TokenCacheSlot {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/**
 * Mutable container for cached access token slots, keyed by scope set.
 * A token minted for one scope set must not satisfy a call needing another
 * (Google returns 403 insufficient_scopes), so each scope set caches separately.
 * Passed in from the factory closure so it lives for the extension lifecycle.
 * Cleared on dispose().
 */
export interface TokenCache {
  slots: Map<string, TokenCacheSlot>;
}

/**
 * Create a new empty token cache.
 * One cache per extension instance; scoped to the factory closure.
 */
export function createTokenCache(): TokenCache {
  return { slots: new Map() };
}

/**
 * Clear the token cache (called on dispose).
 * Idempotent: safe to call multiple times.
 */
export function clearTokenCache(cache: TokenCache): void {
  cache.slots.clear();
}

/**
 * Normalize a scope set into a stable cache key (order-independent).
 */
function scopeCacheKey(scopes: string[]): string {
  return [...scopes].sort().join(' ');
}

// ============================================================
// TOKEN RESOLUTION
// ============================================================

/**
 * Resolve the Bearer token for Google API requests.
 *
 * - bearer: returns auth.token directly (no I/O)
 * - session: reads auth.tokenVar from RuntimeContext parent chain
 * - service-account: uses TTL cache; on miss/expiry signs JWT and exchanges
 * for an access token, caching with TTL = expires_in - 300 s
 * - oauth-refresh: uses TTL cache; on miss/expiry exchanges refresh token for
 * an access token, caching with TTL = expires_in - 300 s
 *
 * The public shape is (auth, ctx) => Promise<string>.
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
 * @throws halt carrying invalid `#AUTH` (`raw.kind == 'session_token_missing'`) if session token variable not found
 * @throws halt carrying invalid `#AUTH` on JWT signing or token exchange failure
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

    // session token variable not found
    failAuth(
      ctx,
      'session_token_missing',
      `google: session token '${tokenVar}' not found`,
      { tokenVar }
    );
  }

  // --- service-account: check TTL cache, sign JWT and exchange on miss ---
  if (auth.type === 'service-account') {
    const cacheKey = scopeCacheKey(scopes);
    // cache hit within TTL — reuse without signing or exchange
    const cachedSa = cache.slots.get(cacheKey);
    if (cachedSa !== undefined && cachedSa.expiresAtMs > Date.now()) {
      return cachedSa.accessToken;
    }

    // cache miss or TTL expired — re-sign and re-exchange
    let key: ServiceAccountKey;
    try {
      key = JSON.parse(auth.keyJson) as ServiceAccountKey;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failAuth(
        ctx,
        'service_account_key_invalid',
        `google: service account key parse failed: ${reason}`
      );
    }

    const assertion = signServiceAccountJwt(ctx, key, scopes, auth.subject);
    const { accessToken, expiresIn } = await exchangeJwtForToken(
      ctx,
      assertion,
      signal
    );

    // cache with TTL = expires_in - 300 seconds
    cache.slots.set(cacheKey, {
      accessToken,
      expiresAtMs: Date.now() + (expiresIn - 300) * 1000,
    });

    return accessToken;
  }

  // --- oauth-refresh: check TTL cache, exchange refresh token on miss ---
  const cacheKey = scopeCacheKey(scopes);
  // cache hit within TTL — reuse without exchange
  const cachedRefresh = cache.slots.get(cacheKey);
  if (cachedRefresh !== undefined && cachedRefresh.expiresAtMs > Date.now()) {
    return cachedRefresh.accessToken;
  }

  // cache miss or TTL expired — exchange refresh token
  const { accessToken, expiresIn } = await exchangeRefreshToken(
    auth.client_id,
    auth.client_secret,
    auth.refresh_token,
    ctx,
    signal
  );

  // cache with TTL = expires_in - 300 seconds
  cache.slots.set(cacheKey, {
    accessToken,
    expiresAtMs: Date.now() + (expiresIn - 300) * 1000,
  });

  return accessToken;
}
