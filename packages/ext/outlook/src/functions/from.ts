/**
 * from host function — list messages from a specific sender address.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch messages filtered by sender email address.
 * Caps `top` at config.maxResults and orders by receivedDateTime descending.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when address is empty
 */
export async function from(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const address = (args['address'] as string | undefined) ?? '';

  if (address.trim() === '') {
    failInput(ctx, 'missing_address', 'outlook: address is required');
  }

  const rawTop = args['top'] as number | undefined;
  const top = Math.min(
    rawTop !== undefined && rawTop > 0 ? Math.floor(rawTop) : config.maxResults,
    config.maxResults
  );

  // Escape single quotes in address for OData filter
  const safeAddress = address.replace(/'/g, "''");
  const path = `messages?$filter=from/emailAddress/address eq '${safeAddress}'&$top=${top}&$orderby=receivedDateTime desc`;

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

  return { messages } as unknown as RillValue;
}
