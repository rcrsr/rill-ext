/**
 * draft host function — save a message as a draft via Graph API.
 * Graph returns HTTP 201 with the created message body.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeMessage } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Create a draft message using Graph /me/messages.
 * `to` accepts a single string (auto-wrapped) or a list of strings.
 * Returns a MailMessageDict from the 201 response body.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when to, subject, or body is empty
 */
export async function draft(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  // auto-wrap single string to list
  const rawTo = args['to'];
  let toList: string[];
  if (typeof rawTo === 'string') {
    toList = [rawTo];
  } else if (Array.isArray(rawTo)) {
    toList = (rawTo as RillValue[]).map((v) => String(v));
  } else {
    toList = [];
  }

  if (toList.length === 0) {
    failInput(ctx, 'missing_to', 'outlook: to is required');
  }

  const subject = (args['subject'] as string | undefined) ?? '';
  if (subject.trim() === '') {
    failInput(ctx, 'missing_subject', 'outlook: subject is required');
  }

  const body = (args['body'] as string | undefined) ?? '';
  if (body.trim() === '') {
    failInput(ctx, 'missing_body', 'outlook: body is required');
  }

  const toRecipients = toList.map((address) => ({
    emailAddress: { address },
  }));

  const requestBody = {
    subject,
    body: { contentType: 'Text', content: body },
    toRecipients,
  };

  const response = await graphFetch(
    'POST',
    'messages',
    config.auth,
    config.mailbox,
    ctx,
    controller,
    requestBody
  );

  return normalizeMessage(response) as unknown as RillValue;
}
