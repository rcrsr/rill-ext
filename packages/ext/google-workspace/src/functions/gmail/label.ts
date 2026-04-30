/**
 * gmail_label callable — apply a named label to a Gmail message.
 * IR-8: gmail_label(messageId: str, labelName: str) → bool
 * Capability: gmail.label
 * Scope: gmail.modify
 *
 * Flow:
 *  EC-6/BC-9/BC-10: Validate labelName against allowedLabels / deniedLabels before fetch.
 *  1. GET /users/me/labels to list all labels
 *  2. Find label by name (case-sensitive)
 *  3. POST /users/me/messages/<id>/modify with { addLabelIds: [labelId] }
 *  4. Return true
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failForbidden, failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { GmailConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
export interface GmailLabelDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly gmailConfig: GmailConfig | undefined;
}
/** Minimal shape of a Gmail API Label object. */
interface GmailLabel {
  id?: string;
  name?: string;
}
/**
 * Validate labelName against allowed/denied label config.
 * EC-6/EC-12: Halts with invalid `#FORBIDDEN` before fetch on violation.
 * BC-9: allowedLabels undefined → all labels accepted.
 * BC-10: allowedLabels non-empty + label not in list → invalid `#FORBIDDEN`.
 */
function validateLabelAccess(
  ctx: RuntimeContext,
  labelName: string,
  gmailConfig: GmailConfig | undefined,
): void {
  const allowedLabels = gmailConfig?.allowedLabels;
  const deniedLabels = gmailConfig?.deniedLabels ?? [];
  // EC-12: Check denied list first (before fetch)
  if (deniedLabels.includes(labelName)) {
    failForbidden(ctx, 'forbidden', `google: label '${labelName}' in denied set`);
  }
  // BC-10: Check allowed list when defined and non-empty
  if (allowedLabels !== undefined && allowedLabels.length > 0) {
    if (!allowedLabels.includes(labelName)) {
      failForbidden(ctx, 'forbidden', `google: label '${labelName}' not in allowed set`);
    }
  }
}
/**
 * Factory returning the gmail_label inner function.
 * Validates label access, resolves the label ID, then applies it via messages.modify.
 * Returns true after 200 OK per IR-8.
 */
export function makeGmailLabel(deps: GmailLabelDeps): (
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
    const labelName = args['label_name'];
    if (typeof labelName !== 'string' || labelName.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: label_name must be a non-empty string');
    }
    // EC-6/EC-12/BC-9/BC-10: Validate before any API call
    validateLabelAccess(ctx, labelName, deps.gmailConfig);
    // Step 1: List all labels to find the label ID by name
    const labelsResponse = await googleFetch(
      'GET',
      GMAIL_BASE,
      '/gmail/v1/users/me/labels',
      'gmail',
      'label',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES
    );
    const labelsData = labelsResponse as { labels?: GmailLabel[] } | null;
    const labels = labelsData?.labels ?? [];
    const matched = labels.find((l) => l.name === labelName);
    if (!matched?.id) {
      throw ctx.invalidate(new Error(`google: label '${labelName}' not found`), { code: 'NOT_FOUND', provider: 'google-workspace', raw: { kind: 'label_not_found', message: `google: label '${labelName}' not found` } });
    }
    // Step 2: Apply label to the message
    const modifyPath = `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`;
    await googleFetch(
      'POST',
      GMAIL_BASE,
      modifyPath,
      'gmail',
      'label',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      GMAIL_SCOPES,
      { addLabelIds: [matched.id] },
      undefined,
      messageId
    );
    return true as unknown as RillValue;
  };
}
