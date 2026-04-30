/**
 * reply host function — reply to an existing message via Graph API.
 * Graph returns HTTP 202 with no body; returns SendConfirmationDict.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Reply to a message using Graph /me/messages/{id}/reply.
 * Returns SendConfirmationDict { sent: true, to: [], subject: '' }.
 * Subject is empty because Graph's 202 response carries no message data.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when messageId or body is empty
 */
export async function reply(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const messageId = (args['message_id'] as string | undefined) ?? '';
  if (messageId.trim() === '') {
    failInput(ctx, 'missing_message_id', 'outlook: message_id is required');
  }

  const body = (args['body'] as string | undefined) ?? '';
  if (body.trim() === '') {
    failInput(ctx, 'missing_body', 'outlook: body is required');
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
