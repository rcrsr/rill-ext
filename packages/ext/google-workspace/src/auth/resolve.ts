/**
 * Token resolution for Google Workspace authentication.
 * Implements resolveToken with a credential-keyed TTL cache for the
 * service-account and oauth-refresh modes.
 */

import { createHash } from 'node:crypto';
import type { RuntimeContext } from '@rcrsr/rill';
import { readHostCredential } from '@rcrsr/rill-ext-auth-shared';
import type { GoogleAuth, ServiceAccountKey } from '../types.js';
import { PROVIDER, failAuth } from '../errors.js';
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
 * Mutable container for cached access token slots, keyed by credential and
 * scope set. A token minted for one credential or scope set must not satisfy a
 * call needing another (a different credential would act as the wrong
 * identity; a different scope set returns 403 insufficient_scopes), so each
 * pair caches separately.
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
 * Hash credential parts into a hex digest. Parts are JSON-encoded as an array,
 * so (a, bc) and (ab, c) differ and null (absent) differs from any string.
 * Raw credential material never appears in a cache key.
 */
function credentialDigest(parts: readonly (string | null)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * Identify the credential behind a service-account or oauth-refresh auth.
 */
function credentialIdOf(
  auth: Extract<GoogleAuth, { type: 'service-account' | 'oauth-refresh' }>
): string {
  if (auth.type === 'service-account') {
    return credentialDigest([
      auth.type,
      auth.keyJson,
      auth.subject === undefined ? null : auth.subject,
    ]);
  }
  return credentialDigest([auth.type, auth.client_id, auth.refresh_token]);
}

/**
 * Build the cache key for a credential and an order-independent scope set.
 * The only way to build a slot key.
 */
function tokenCacheKey(credentialId: string, scopes: string[]): string {
  return `${credentialId}:${JSON.stringify([...scopes].sort())}`;
}

// ============================================================
// TOKEN RESOLUTION
// ============================================================

/**
 * Resolve the Bearer token for Google API requests.
 *
 * - bearer: returns auth.token directly (no I/O)
 * - session: reads auth.tokenVar from ctx.hostContext (never script variables)
 * - service-account: uses TTL cache keyed by credential and scopes; on miss/expiry signs JWT and exchanges
 * for an access token, caching with TTL = expires_in - 300 s
 * - oauth-refresh: uses TTL cache keyed by credential and scopes; on miss/expiry exchanges refresh token for
 * an access token, caching with TTL = expires_in - 300 s
 *
 * The public shape is (auth, ctx) => Promise<string>.
 * The additional `cache`, `scopes`, and `signal` parameters are required
 * for the service-account flow and are supplied by the factory closure.
 * The factory binds these to produce the (auth, ctx) => Promise<string>
 * closure.
 *
 * @param auth - Validated GoogleAuth discriminated union
 * @param ctx - RuntimeContext; session mode reads its hostContext
 * @param cache - Factory-scoped token cache (cleared on dispose)
 * @param scopes - OAuth2 scopes for service-account JWT; ignored for other modes
 * @param signal - AbortSignal for token exchange HTTP request cancellation
 * @returns Resolved Bearer token string
 * @throws halt carrying invalid `#AUTH` (`raw.kind == 'session_token_missing'`) if the session token is absent from hostContext
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

  // --- session: read tokenVar from the host context ---
  if (auth.type === 'session') {
    return readHostCredential(ctx, {
      key: auth.tokenVar,
      provider: PROVIDER,
      label: 'google',
    });
  }

  // --- service-account: check TTL cache, sign JWT and exchange on miss ---
  if (auth.type === 'service-account') {
    const cacheKey = tokenCacheKey(credentialIdOf(auth), scopes);
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
  const cacheKey = tokenCacheKey(credentialIdOf(auth), scopes);
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
