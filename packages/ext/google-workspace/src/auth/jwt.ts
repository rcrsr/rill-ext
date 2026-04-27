/**
 * JWT signing utilities for Google service account authentication.
 * Implements IR-22: signServiceAccountJwt.
 */

import { createSign } from 'node:crypto';
import type { RuntimeContext } from '@rcrsr/rill';
import type { ServiceAccountKey } from '../types.js';
import { failAuth } from '../errors.js';

/** JWT header — RS256 algorithm, JWT type (AC-9). */
const JWT_HEADER = { alg: 'RS256', typ: 'JWT' } as const;

/** Google OAuth2 token endpoint audience (AC-9). */
const GOOGLE_TOKEN_AUD = 'https://oauth2.googleapis.com/token';

/** JWT lifetime in seconds — 3600 enforced by Google (AC-9). */
const JWT_LIFETIME_SECONDS = 3600;

/**
 * Encode a string or Buffer to base64url without padding.
 * Buffer.from(...).toString('base64url') is supported in Node 16+.
 */
function toBase64Url(value: string | Buffer): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buf.toString('base64url');
}

/**
 * Sign a GCP service account JWT for OAuth2 token exchange (IR-22).
 *
 * Claims include iss, scope (space-separated), aud, iat, exp, and optional sub.
 * exp is always iat + 3600 (AC-9).
 *
 * @param key - Parsed service account key fields
 * @param scopes - OAuth2 scopes to request
 * @param subject - Optional email to impersonate via domain-wide delegation
 * @returns Base64url-encoded JWT assertion: <header>.<payload>.<signature>
 * @throws halt carrying invalid `#AUTH` (`raw.kind == 'jwt_sign_failed'`) on signing failure
 */
export function signServiceAccountJwt(
  ctx: RuntimeContext,
  key: ServiceAccountKey,
  scopes: string[],
  subject?: string | undefined,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + JWT_LIFETIME_SECONDS;

  const header = toBase64Url(JSON.stringify(JWT_HEADER));

  const claims: Record<string, unknown> = {
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: GOOGLE_TOKEN_AUD,
    exp,
    iat,
  };

  if (subject !== undefined) {
    claims['sub'] = subject;
  }

  const payload = toBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  try {
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    const signatureBuffer = signer.sign(key.private_key);
    const signature = toBase64Url(signatureBuffer);
    return `${signingInput}.${signature}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failAuth(ctx, 'jwt_sign_failed', `google: JWT signing failed: ${reason}`);
  }

  // Unreachable: failAuth always throws
  return '';
}
