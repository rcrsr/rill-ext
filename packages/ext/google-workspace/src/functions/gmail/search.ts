/**
 * gmail_search callable — search Gmail messages by query string.
 * gmail_search(query: str, options: dict?) → { messages: list[dict] }
 * Capability: gmail.search
 * Scope: gmail.readonly
 */
import { isDict } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { GmailConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
/** Default and ceiling for maxResults. */
const DEFAULT_MAX_RESULTS = 50;
export interface GmailSearchDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly gmailConfig: GmailConfig | undefined;
}
/**
 * Factory returning the gmail_search inner function.
 * Truncates options.maxResults to gmailConfig.maxResults ceiling (default 50).
 * Returns rill primitive dict { messages: list[dict] }.
 */
export function makeGmailSearch(
  deps: GmailSearchDeps
): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const query = args['query'];
    if (typeof query !== 'string' || query.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: query must be a non-empty string');
    }
    // cap maxResults at the configured ceiling (default 50)
    const ceiling = deps.gmailConfig?.maxResults ?? DEFAULT_MAX_RESULTS;
    let maxResults = ceiling;
    const options = args['options'];
    if (options !== undefined && options !== null && isDict(options)) {
      const rawMax = options['max_results'];
      if (typeof rawMax === 'number' && rawMax > 0) {
        maxResults = Math.min(rawMax, ceiling);
      }
    }
    const encodedQuery = encodeURIComponent(query);
    const path = `/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=${maxResults}`;
    const response = await googleFetch(
      'GET',
      GMAIL_BASE,
      path,
      'gmail',
      'search',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      undefined,
      undefined,
      undefined
    );
    // Project response to { messages: [{ id, thread_id }, ...] }
    const data = response as {
      messages?: Array<{ id?: string; threadId?: string }>;
    } | null;
    const rawMessages = data?.messages ?? [];
    const messages = rawMessages.map((m) => ({
      id: m.id ?? '',
      thread_id: m.threadId ?? '',
    }));
    return { messages } as unknown as RillValue;
  };
}
