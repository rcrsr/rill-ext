/**
 * OAuth2 JWT bearer token exchange for Google service account authentication.
 * Implements IR-23: exchangeJwtForAccessToken and internal exchangeJwtForToken.
 */

import { RuntimeError } from '@rcrsr/rill';

/** Google OAuth2 token endpoint URL (AC-9 — HTTPS only, fixed URL). */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** OAuth2 JWT bearer grant type. */
const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/**
 * Result of a successful JWT-bearer token exchange.
 * Internal shape used by resolveToken (Task 2.2) to compute cache TTL.
 * Cache TTL = expires_in - 300 (BC-6/BC-7).
 */
export interface JwtTokenResult {
  readonly accessToken: string;
  readonly expiresIn: number;
}

/**
 * Exchange a signed JWT assertion for a Google OAuth2 access token (IR-23 internal).
 *
 * Returns both the access token and expires_in so the caller (resolveToken in 2.2)
 * can compute the cache TTL as expires_in - 300 (BC-6/BC-7).
 *
 * @param assertion - Base64url JWT assertion from signServiceAccountJwt
 * @param signal - AbortSignal for request cancellation
 * @returns Object with accessToken and expiresIn
 * @throws RuntimeError (RILL-R004) on non-OK HTTP response (token never in message)
 * @throws Network errors are rethrown for caller to wrap via mapFetchError
 */
export async function exchangeJwtForToken(
  assertion: string,
  signal: AbortSignal
): Promise<JwtTokenResult> {
  const body = new URLSearchParams({
    grant_type: JWT_BEARER_GRANT_TYPE,
    assertion,
  });

  // Network errors propagate to caller — do not catch here (IR-23).
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    // Token must never appear in error messages (IR-23 security constraint).
    throw new RuntimeError(
      'RILL-R004',
      `google: token exchange failed: ${response.status}`
    );
  }

  const json = (await response.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
  };
}

/**
 * Exchange a signed JWT assertion for a Google OAuth2 access token (IR-23).
 *
 * Thin wrapper over exchangeJwtForToken that returns only the access_token string
 * per the IR-23 signature. Task 2.2 (resolveToken) should call exchangeJwtForToken
 * directly to access expires_in for cache TTL computation (BC-6/BC-7).
 *
 * @param assertion - Base64url JWT assertion from signServiceAccountJwt
 * @param signal - AbortSignal for request cancellation
 * @returns Access token string
 * @throws RuntimeError (RILL-R004) on non-OK HTTP response
 * @throws Network errors are rethrown for caller to wrap via mapFetchError
 */
export async function exchangeJwtForAccessToken(
  assertion: string,
  signal: AbortSignal
): Promise<string> {
  const result = await exchangeJwtForToken(assertion, signal);
  return result.accessToken;
}
