/**
 * flag host function — flag a message via Graph PATCH.
 * Graph returns HTTP 200 with the updated message body.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Flag a message by setting flag.flagStatus to 'flagged'.
 * Uses PATCH /me/messages/{id}. Returns the updated MailMessageDict.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when messageId is empty
 */
export async function flag(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const messageId = (args['message_id'] as string | undefined) ?? '';
  if (messageId.trim() === '') {
    failInput(ctx, 'missing_message_id', 'outlook: message_id is required');
  }

  const path = `messages/${encodeURIComponent(messageId)}`;

  const response = await graphFetch(
    'PATCH',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller,
    { flag: { flagStatus: 'flagged' } }
  );

  return normalizeMessage(response) as unknown as RillValue;
}
