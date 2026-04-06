/**
 * Microsoft Graph API fetch wrapper for Outlook extension.
 * Builds authenticated requests with mailbox-aware URL routing,
 * combined abort/timeout signals, and error mapping.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import { resolveToken } from './config.js';
import { mapFetchError, mapGraphError } from './errors.js';
import type { OutlookAuth } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 30000;

// ============================================================
// GRAPH FETCH
// ============================================================

/**
 * Perform an authenticated Microsoft Graph API request.
 *
 * Resolves the Bearer token via resolveToken, builds the full URL
 * with mailbox-aware path prefix (/me/ or /users/{mailbox}/),
 * combines the caller's abort controller signal with a 30s timeout,
 * and maps non-OK responses to RuntimeError via mapGraphError.
 *
 * @param method - HTTP method (GET, POST, PATCH, DELETE)
 * @param path - Graph API path relative to the mailbox root (e.g. 'messages', 'mailFolders/inbox/messages')
 * @param auth - Authentication config for token resolution
 * @param mailbox - Optional shared mailbox UPN/ID; uses /me/ when undefined
 * @param ctx - RuntimeContext for session token lookup
 * @param controller - AbortController for caller-side cancellation
 * @param body - Optional request body (POST/PATCH)
 * @returns Parsed JSON response body
 * @throws RuntimeError on non-OK response or network failure
 */
export async function graphFetch(
  method: string,
  path: string,
  auth: OutlookAuth,
  mailbox: string | undefined,
  ctx: RuntimeContext,
  controller: AbortController,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<unknown> {
  const token = resolveToken(auth, ctx);

  // Build mailbox-aware base: /me/ or /users/{mailbox}/
  const mailboxSegment =
    mailbox !== undefined ? `/users/${mailbox}` : '/me';
  const url = `${GRAPH_BASE_URL}${mailboxSegment}/${path}`;

  // Combine caller signal with 30s hard timeout
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };

  // Only set Content-Type for requests with a body
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const init =
    body !== undefined
      ? { method, headers, signal, body: JSON.stringify(body) }
      : { method, headers, signal };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw mapFetchError(error);
  }

  if (!response.ok) {
    throw mapGraphError(response.status, path.split('?')[0] ?? path);
  }

  // 202 Accepted and 204 No Content carry no response body
  if (response.status === 202 || response.status === 204) {
    return null;
  }

  return response.json() as Promise<unknown>;
}
