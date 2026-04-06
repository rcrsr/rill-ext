/**
 * flag host function — flag a message via Graph PATCH.
 * Graph returns HTTP 200 with the updated message body.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Flag a message by setting flag.flagStatus to 'flagged'.
 * Uses PATCH /me/messages/{id}. Returns the updated MailMessageDict.
 *
 * @throws RuntimeError (RILL-R004) when messageId is empty
 */
export async function flag(
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
