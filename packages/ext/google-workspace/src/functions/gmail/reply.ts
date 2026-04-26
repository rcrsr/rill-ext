/**
 * gmail_reply callable — reply to an existing Gmail message.
 * IR-6: gmail_reply(messageId: str, body: str, options: dict?) → str (message ID)
 * Capability: gmail.reply
 * Scope: gmail.send
 *
 * Flow:
 *  1. GET /users/me/messages/<id>?format=metadata&metadataHeaders=Message-Id
 *               &metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From
 *  2. Extract threadId, Message-Id, References, Subject, From headers
 *  3. Build Reply-To MIME with In-Reply-To + References threading headers
 *  4. POST /users/me/messages/send with { raw, threadId }
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
import { buildRawMime } from './mime.js';

const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

export interface GmailReplyDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}

/** Minimal shape returned by Gmail metadata fetch. */
interface GmailMetadataMessage {
  id?: string;
  threadId?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
}

/**
 * Factory returning the gmail_reply inner function.
 * Fetches thread metadata, builds RFC 2822 reply MIME with threading headers,
 * and POSTs to messages/send with the threadId.
 */
export function makeGmailReply(deps: GmailReplyDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const messageId = args['messageId'];
    if (typeof messageId !== 'string' || messageId.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: messageId must be a non-empty string');
    }

    const body = args['body'];
    if (typeof body !== 'string') {
      throw new RuntimeError('RILL-R004', 'google: body must be a string');
    }

    // Step 1: GET message metadata for threading headers
    const metadataPath =
      `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}` +
      `?format=metadata` +
      `&metadataHeaders=Message-Id` +
      `&metadataHeaders=References` +
      `&metadataHeaders=Subject` +
      `&metadataHeaders=From`;

    const metaResponse = await googleFetch(
      'GET',
      GMAIL_BASE,
      metadataPath,
      'gmail',
      'reply',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      undefined,
      undefined,
      messageId
    );

    const meta = metaResponse as GmailMetadataMessage | null;
    const threadId = meta?.threadId ?? '';

    const headerList = meta?.payload?.headers ?? [];
    const getHeader = (name: string): string => {
      const h = headerList.find(
        (hdr) => hdr.name?.toLowerCase() === name.toLowerCase()
      );
      return h?.value ?? '';
    };

    const originalMessageId = getHeader('Message-Id');
    const existingReferences = getHeader('References');
    const originalSubject = getHeader('Subject');
    const originalFrom = getHeader('From');

    // Build References chain: previous References + original Message-Id
    const references = existingReferences
      ? `${existingReferences} ${originalMessageId}`.trim()
      : originalMessageId;

    // Use "Re: " prefix convention if not already present
    const replySubject = originalSubject.startsWith('Re:')
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Build raw MIME with threading headers
    const raw = buildRawMime({
      to: originalFrom,
      subject: replySubject,
      body,
      inReplyTo: originalMessageId || undefined,
      references: references || undefined,
    });

    // Step 2: POST reply with threadId for threading
    const sendBody: Record<string, unknown> = { raw };
    if (threadId) {
      sendBody['threadId'] = threadId;
    }

    const sendResponse = await googleFetch(
      'POST',
      GMAIL_BASE,
      '/gmail/v1/users/me/messages/send',
      'gmail',
      'reply',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      sendBody
    );

    const data = sendResponse as { id?: string } | null;
    return (data?.id ?? '') as unknown as RillValue;
  };
}
