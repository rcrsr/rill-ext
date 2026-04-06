/**
 * reply host function — reply to an existing message via Graph API.
 * Graph returns HTTP 202 with no body; returns SendConfirmationDict.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Reply to a message using Graph /me/messages/{id}/reply.
 * Returns SendConfirmationDict { sent: true, to: [], subject: '' }.
 * Subject is empty because Graph's 202 response carries no message data.
 *
 * @throws RuntimeError (RILL-R004) when messageId or body is empty
 */
export async function reply(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const messageId = (args['messageId'] as string | undefined) ?? '';
  if (messageId.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: messageId is required');
  }

  const body = (args['body'] as string | undefined) ?? '';
  if (body.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: body is required');
  }

  const path = `messages/${encodeURIComponent(messageId)}/reply`;

  // Graph returns 202 with no body; graphFetch returns null for 202
  await graphFetch(
    'POST',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller,
    { comment: body }
  );

  // subject is empty: Graph 202 response carries no message metadata
  return { sent: true, to: [] as string[], subject: '' } as unknown as RillValue;
}
