/**
 * inbox host function — list messages from the configured folder.
 * Supports optional unread filter and top cap at config.maxResults.
 */

import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { checkFolder } from '../capabilities.js';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch messages from the configured mailbox folder.
 * Caps `top` at config.maxResults (host-enforced ceiling).
 * Uses `$filter=isRead eq false` when unread=true, otherwise
 * orders by receivedDateTime descending.
 */
export async function inbox(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const rawTop = args['top'] as number | undefined;
  const unread = args['unread'] as boolean | undefined;
  const folder = args['folder'] as string | undefined;

  // Enforce folder allowlist before any API call (EC-4 / AC-22)
  if (folder !== undefined) {
    checkFolder(ctx, config.folders, folder);
  }

  // Cap top at maxResults ceiling
  const top = Math.min(
    rawTop !== undefined && rawTop > 0 ? Math.floor(rawTop) : config.maxResults,
    config.maxResults
  );

  const base =
    folder !== undefined
      ? `mailFolders/${encodeURIComponent(folder)}/messages`
      : 'messages';

  let path: string;
  if (unread === true) {
    path = `${base}?$top=${top}&$filter=isRead eq false`;
  } else {
    path = `${base}?$top=${top}&$orderby=receivedDateTime desc`;
  }

  const response = await graphFetch(
    'GET',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller
  );

  const data = response as { value?: unknown[] };
  const messages = (data.value ?? []).map(normalizeMessage);

  return { messages, folder: folder ?? 'inbox' } as unknown as RillValue;
}
