/**
 * Authenticated HTTP wrapper for Google Workspace API requests.
 * Implements token resolution, signal combination, error mapping.
 */

import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import type { GoogleAuth } from './types.js';
import type { TokenCache } from './auth/resolve.js';
import { resolveToken } from './auth/resolve.js';
import { mapGoogleError, mapFetchError, failInput } from './errors.js';

/** Fixed request timeout. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Perform an authenticated Google API request.
 *
 * Resolves the Bearer token via resolveToken, combines abort signals,
 * builds the request, and maps HTTP/network errors to RuntimeError.
 *
 * The public signature lists (auth, ctx) as resolver params.
 * This implementation widens to also accept cache, scopes, and resourceId
 * because resolveToken requires them and mapGoogleError needs service/operation.
 * The factory closure will bind these to produce per-service helpers. [SPEC]
 *
 * @param method - HTTP method (GET, POST, PATCH, DELETE, etc.)
 * @param baseUrl - HTTPS base URL (e.g. "https://gmail.googleapis.com")
 * @param path - Path appended to baseUrl (e.g. "/gmail/v1/users/me/messages")
 * @param service - Google service identifier for error messages
 * @param operation - Operation name for 403 scope error (e.g. "send")
 * @param auth - Validated GoogleAuth discriminated union
 * @param ctx - RuntimeContext for session token lookup
 * @param controller - AbortController from the calling host function
 * @param cache - Factory-scoped token cache (service-account mode)
 * @param scopes - OAuth2 scopes for service-account token exchange
 * @param body - Optional request body (serialized as JSON)
 * @param headers - Optional extra request headers
 * @param resourceId - Optional resource ID for 404 error messages
 * @returns Parsed JSON response body, or null for 202/204 responses
 * @throws halt carrying invalid generic atom on HTTP errors: `#AUTH` (401), `#FORBIDDEN` (403), `#NOT_FOUND` (404), `#RATE_LIMIT` (429), `#UNAVAILABLE` (5xx)
 * @throws halt carrying invalid `#TIMEOUT` (`request_timeout`) or `#UNAVAILABLE` (`connection_failed`) on network/abort errors
 * @throws halt carrying invalid `#INVALID_INPUT` if baseUrl is not HTTPS
 */
export async function googleFetch(
  method: string,
  baseUrl: string,
  path: string,
  service: 'gmail' | 'drive' | 'calendar',
  operation: string,
  auth: GoogleAuth,
  ctx: RuntimeContext,
  controller: AbortController,
  cache: TokenCache,
  scopes: string[],
  body?: unknown,
  headers?: Record<string, string>,
  resourceId?: string
): Promise<unknown> {
  // Security defense in depth: assert HTTPS-only baseUrl
  if (!baseUrl.startsWith('https://')) {
    failInput(ctx, 'baseurl_not_https', 'google: baseUrl must be HTTPS');
  }

  // combine lifecycle (ctx.signal), caller signal, and 30s hard timeout
  const signals: AbortSignal[] = [
    controller.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ];
  if (ctx.signal !== undefined) {
    signals.unshift(ctx.signal);
  }
  const combinedSignal = AbortSignal.any(signals);

  // Resolve Bearer token — pass combinedSignal so exchange honors the 30s limit
  const token = await resolveToken(auth, ctx, cache, scopes, combinedSignal);

  const url = `${baseUrl}${path}`;

  const requestHeaders: Record<string, string> = {
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(headers ?? {}),
    Authorization: `Bearer ${token}`,
  };

  const init =
    body !== undefined
      ? {
          method,
          headers: requestHeaders,
          signal: combinedSignal,
          body: JSON.stringify(body),
        }
      : { method, headers: requestHeaders, signal: combinedSignal };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw mapFetchError(ctx, error, service) as unknown as RillValue;
  }

  if (!response.ok) {
    throw mapGoogleError(
      ctx,
      response.status,
      service,
      operation,
      resourceId
    ) as unknown as RillValue;
  }

  // 202 Accepted and 204 No Content carry no response body
  if (response.status === 202 || response.status === 204) {
    return null;
  }

  return response.json() as Promise<unknown>;
}
