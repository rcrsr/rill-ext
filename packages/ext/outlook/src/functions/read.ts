/**
 * read host function — fetch a single message by ID.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch a single mail message by its Graph API message ID.
 * Returns a MailMessageDict with no folder restriction.
 *
 * @throws RuntimeError (RILL-R004) when messageId is empty
 */
export async function read(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const messageId = (args['messageId'] as string | undefined) ?? '';

  if (messageId.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: messageId is required');
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
