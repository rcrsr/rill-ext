/**
 * OAuth2 JWT bearer token exchange for Google service account authentication.
 * Implements exchangeJwtForAccessToken and internal exchangeJwtForToken.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import { failAuth } from '../errors.js';

/** Google OAuth2 token endpoint URL (HTTPS only, fixed URL). */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** OAuth2 JWT bearer grant type. */
const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/**
 * Result of a successful Google OAuth2 token exchange.
 * Shared by the JWT-bearer (`exchangeJwtForToken`) and refresh-token
 * (`exchangeRefreshToken`) flows. Internal shape used by `resolveToken`
 * to compute the cache TTL = `expires_in - 300`.
 */
export interface TokenExchangeResult {
  readonly accessToken: string;
  readonly expiresIn: number;
}

/**
 * Exchange a signed JWT assertion for a Google OAuth2 access token (internal).
 *
 * Returns both the access token and expires_in so the caller (resolveToken in 2.2)
 * can compute the cache TTL as expires_in - 300.
 *
 * On non-OK HTTP response throws an invalid RillValue carrying `#AUTH`
 * with `meta.raw.kind = 'token_refresh_failed'`. The token never appears
 * in the message (security constraint).
 *
 * Network errors propagate to caller for `mapFetchError` to handle.
 */
export async function exchangeJwtForToken(
  ctx: RuntimeContext,
  assertion: string,
  signal: AbortSignal
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: JWT_BEARER_GRANT_TYPE,
    assertion,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    failAuth(
      ctx,
      'token_refresh_failed',
      `google: token exchange failed: ${response.status}`,
      { status: response.status }
    );
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
  };
}

/**
 * Exchange a signed JWT assertion for a Google OAuth2 access token.
 * Thin wrapper that returns only the access token string.
 */
export async function exchangeJwtForAccessToken(
  ctx: RuntimeContext,
  assertion: string,
  signal: AbortSignal
): Promise<string> {
  const result = await exchangeJwtForToken(ctx, assertion, signal);
  return result.accessToken;
}

/**
 * Exchange an OAuth2 refresh token for a Google access token.
 *
 * Returns both the access token and expires_in so the caller can compute
 * the cache TTL as expires_in - 300.
 *
 * On non-OK HTTP response throws an invalid RillValue carrying `#AUTH`
 * with `meta.raw.kind = 'token_refresh_failed'`. Neither clientSecret nor
 * refreshToken appears in any error message (security constraint).
 *
 * Network errors propagate to caller for `mapFetchError` to handle.
 */
export async function exchangeRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  ctx: RuntimeContext,
  signal: AbortSignal
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    failAuth(
      ctx,
      'token_refresh_failed',
      `google: token exchange failed: ${response.status}`,
      { status: response.status }
    );
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
  };
}
