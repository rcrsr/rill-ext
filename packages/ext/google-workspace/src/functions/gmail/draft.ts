/**
 * gmail_draft callable — create a Gmail draft message.
 * gmail_draft(to: str, subject: str, body: str, options: dict?) → str (draft ID)
 * Capability: gmail.draft
 * Scope: gmail.compose
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
import { buildRawMime } from './mime.js';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
export interface GmailDraftDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the gmail_draft inner function.
 * POSTs base64url-encoded RFC 2822 MIME to /users/me/drafts.
 * Returns the draft ID string.
 */
export function makeGmailDraft(
  deps: GmailDraftDeps
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
    const to = args['to'];
    if (typeof to !== 'string' || to.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: to must be a non-empty string');
    }
    const subject = args['subject'];
    if (typeof subject !== 'string' || subject.trim() === '') {
      failInput(
        ctx,
        'invalid_arg',
        'google: subject must be a non-empty string'
      );
    }
    const body = args['body'];
    if (typeof body !== 'string') {
      failInput(ctx, 'invalid_arg', 'google: body must be a string');
    }
    const raw = buildRawMime({ to, subject, body });
    const response = await googleFetch(
      'POST',
      GMAIL_BASE,
      '/gmail/v1/users/me/drafts',
      'gmail',
      'draft',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      { message: { raw } }
    );
    const data = response as { id?: string } | null;
    return (data?.id ?? '') as unknown as RillValue;
  };
}
