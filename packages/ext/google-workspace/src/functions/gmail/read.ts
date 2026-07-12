/**
 * gmail_read callable — fetch a full Gmail message by ID.
 * IR-3: gmail_read(messageId: str) → dict { id, threadId, headers, body, attachments }
 * Capability: gmail.read
 * Scope: gmail.readonly
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
export interface GmailReadDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/** Minimal shape for a Gmail API message part. */
interface MessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: MessagePart[];
  filename?: string;
}
/** Gmail API message payload shape. */
interface GmailMessage {
  id?: string;
  threadId?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    body?: { data?: string };
    parts?: MessagePart[];
    mimeType?: string;
  };
}
/**
 * Decode base64url-encoded string to UTF-8 text.
 * Returns empty string on missing or malformed input.
 */
function decodeBase64Url(encoded: string | undefined): string {
  if (!encoded) return '';
  try {
    return Buffer.from(encoded, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}
/**
 * Find the plain-text body from MIME parts, falling back to HTML then raw body.
 */
function extractBody(part: MessagePart | undefined): string {
  if (!part) return '';
  // Prefer text/plain
  if (part.mimeType === 'text/plain') {
    return decodeBase64Url(part.body?.data);
  }
  // Recurse into sub-parts
  if (Array.isArray(part.parts)) {
    for (const subPart of part.parts) {
      const text = extractBody(subPart);
      if (text) return text;
    }
  }
  // Fall back to raw body data for simple messages
  if (part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  return '';
}
/**
 * Collect attachment metadata from MIME parts.
 */
function extractAttachments(
  parts: MessagePart[] | undefined
): Array<{ filename: string; mime_type: string; size: number }> {
  if (!Array.isArray(parts)) return [];
  const results: Array<{ filename: string; mime_type: string; size: number }> =
    [];
  for (const part of parts) {
    if (part.filename && part.filename !== '') {
      results.push({
        filename: part.filename,
        mime_type: part.mimeType ?? '',
        size: part.body?.size ?? 0,
      });
    }
    if (Array.isArray(part.parts)) {
      results.push(...extractAttachments(part.parts));
    }
  }
  return results;
}
/**
 * Factory returning the gmail_read inner function.
 * AC-12: Returns rill primitive dict with headers/body/attachments.
 */
export function makeGmailRead(
  deps: GmailReadDeps
): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const messageId = args['message_id'];
    if (typeof messageId !== 'string' || messageId.trim() === '') {
      failInput(
        ctx,
        'invalid_arg',
        'google: message_id must be a non-empty string'
      );
    }
    const path = `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
    const response = await googleFetch(
      'GET',
      GMAIL_BASE,
      path,
      'gmail',
      'read',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      undefined,
      undefined,
      messageId
    );
    const msg = response as GmailMessage | null;
    // Extract well-known headers
    const headerList = msg?.payload?.headers ?? [];
    const getHeader = (name: string): string => {
      const header = headerList.find(
        (h) => h.name?.toLowerCase() === name.toLowerCase()
      );
      return header?.value ?? '';
    };
    const headers = {
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
    };
    // Decode body from MIME payload
    const payload = msg?.payload;
    const body = extractBody(payload as MessagePart | undefined);
    // Collect attachment metadata
    const attachments = extractAttachments(payload?.parts);
    return {
      id: msg?.id ?? messageId,
      thread_id: msg?.threadId ?? '',
      headers,
      body,
      attachments,
    } as unknown as RillValue;
  };
}
