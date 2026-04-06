/**
 * send host function — send an email message via Graph API.
 * Graph returns HTTP 202 with no body; returns SendConfirmationDict.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Send an email message using Graph /me/sendMail.
 * `to` accepts a single string (auto-wrapped) or a list of strings (AC-37).
 * Returns SendConfirmationDict { sent: true, to, subject }.
 *
 * @throws RuntimeError (RILL-R004) when to, subject, or body is empty
 */
export async function send(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  // AC-37: auto-wrap single string to list
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
    throw new RuntimeError('RILL-R004', 'outlook: to is required');
  }

  const subject = (args['subject'] as string | undefined) ?? '';
  if (subject.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: subject is required');
  }

  const body = (args['body'] as string | undefined) ?? '';
  if (body.trim() === '') {
    throw new RuntimeError('RILL-R004', 'outlook: body is required');
  }

  const toRecipients = toList.map((address) => ({
    emailAddress: { address },
  }));

  const requestBody = {
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients,
    },
  };

  // Graph returns 202 with no body; graphFetch returns null for 202
  await graphFetch(
    'POST',
    'sendMail',
    config.auth,
    config.mailbox,
    ctx,
    controller,
    requestBody
  );

  return { sent: true, to: toList, subject } as unknown as RillValue;
}
