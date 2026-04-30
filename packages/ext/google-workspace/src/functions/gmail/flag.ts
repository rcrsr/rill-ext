/**
 * gmail_flag callable — add or remove the STARRED label on a Gmail message.
 * IR-7: gmail_flag(messageId: str, flagged: bool) → bool
 * Capability: gmail.modify
 * Scope: gmail.modify
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
export interface GmailFlagDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the gmail_flag inner function.
 * Uses messages.modify to add or remove the STARRED system label.
 * Returns true after 200 OK per IR-7.
 */
export function makeGmailFlag(deps: GmailFlagDeps): (
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
      failInput(ctx, 'invalid_arg', 'google: message_id must be a non-empty string');
    }
    const flagged = args['flagged'];
    if (typeof flagged !== 'boolean') {
      failInput(ctx, 'invalid_arg', 'google: flagged must be a boolean');
    }
    const modifyBody = flagged
      ? { addLabelIds: ['STARRED'] }
      : { removeLabelIds: ['STARRED'] };
    const path = `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`;
    await googleFetch(
      'POST',
      GMAIL_BASE,
      path,
      'gmail',
      'flag',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      modifyBody,
      undefined,
      messageId
    );
    return true as unknown as RillValue;
  };
}
