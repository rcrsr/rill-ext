/**
 * Microsoft Graph API fetch wrapper for Outlook extension.
 * Builds authenticated requests with mailbox-aware URL routing,
 * combined abort/timeout/lifecycle signals, and error mapping.
 *
 * On failure throws an invalid RillValue (via mapGraphError /
 * mapFetchError); the wrap()'s catch passes it through unchanged.
 */

import type { RillValue, RuntimeContext } from '@rcrsr/rill';
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

export async function graphFetch(
  method: string,
  path: string,
  auth: OutlookAuth,
  mailbox: string | undefined,
  ctx: RuntimeContext,
  controller: AbortController,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const token = resolveToken(auth, ctx);

  const mailboxSegment =
    mailbox !== undefined ? `/users/${mailbox}` : '/me';
  const url = `${GRAPH_BASE_URL}${mailboxSegment}/${path}`;

  // Compose lifecycle (ctx.signal), per-request controller, and 30s timeout.
  const signals: AbortSignal[] = [
    controller.signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ];
  if (ctx.signal !== undefined) {
    signals.unshift(ctx.signal);
  }
  const signal = AbortSignal.any(signals);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };

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
    throw mapFetchError(ctx, error) as unknown as RillValue;
  }

  if (!response.ok) {
    throw mapGraphError(
      ctx,
      response.status,
      path.split('?')[0] ?? path,
    ) as unknown as RillValue;
  }

  if (response.status === 202 || response.status === 204) {
    return null;
  }

  return response.json() as Promise<unknown>;
}
