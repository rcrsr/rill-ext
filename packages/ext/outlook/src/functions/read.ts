/**
 * read host function — fetch a single message by ID.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch a single mail message by its Graph API message ID.
 * Returns a MailMessageDict with no folder restriction.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when messageId is empty
 */
export async function read(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const messageId = (args['messageId'] as string | undefined) ?? '';

  if (messageId.trim() === '') {
    failInput(ctx, 'missing_message_id', 'outlook: messageId is required');
  }

  const path = `messages/${encodeURIComponent(messageId)}`;

  const response = await graphFetch(
    'GET',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller
  );

  return normalizeMessage(response) as unknown as RillValue;
}
