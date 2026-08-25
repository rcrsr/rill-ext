/**
 * Minimal RFC 2822 MIME builder for Gmail API raw message encoding.
 * Produces base64url-encoded MIME messages suitable for:
 *   - messages.send: { raw }
 *   - drafts.create: { message: { raw } }
 */

export interface MimeOptions {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Optional: In-Reply-To header value (Message-Id of the original). */
  readonly inReplyTo?: string | undefined;
  /** Optional: References header value for threading. */
  readonly references?: string | undefined;
}

/**
 * Strip CR/LF from a header field value so a script-supplied string cannot
 * inject extra headers (e.g. a subject carrying "\r\nBcc: x@y"). Folding is
 * not needed here, so line breaks are collapsed to a single space.
 */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/**
 * Build a base64url-encoded RFC 2822 MIME message string.
 * Uses "From: me" which Gmail API resolves to the authenticated user.
 */
export function buildRawMime(opts: MimeOptions): string {
  const lines: string[] = [
    `From: me`,
    `To: ${sanitizeHeaderValue(opts.to)}`,
    `Subject: ${sanitizeHeaderValue(opts.subject)}`,
  ];

  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${sanitizeHeaderValue(opts.inReplyTo)}`);
  }
  if (opts.references) {
    lines.push(`References: ${sanitizeHeaderValue(opts.references)}`);
  }

  lines.push('', opts.body);

  const mime = lines.join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
