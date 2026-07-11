/**
 * Pure helpers for MIME content-transfer-encoding decoding.
 *
 * No external dependencies — uses built-in string operations only (TD-6).
 *
 * @module
 */

/**
 * Decode a quoted-printable encoded string.
 *
 * Rules applied (RFC 2045 §6.7):
 * - `=\r\n` and `=\n` soft line breaks are removed (joined), dropping the
 *   line-ending characters entirely.
 * - `=XX` sequences (where XX is two uppercase or lowercase hex digits) are
 *   decoded to the corresponding UTF-8 byte sequence.
 * - All other characters pass through unchanged, so plain-text input is
 *   returned as-is (AC-37).
 *
 * The function decodes the full byte sequence and then re-interprets it as
 * UTF-8 via `decodeURIComponent` + `%XX` substitution, preserving multi-byte
 * characters that span consecutive `=XX` tokens.
 */
export function decodeQuotedPrintable(text: string): string {
  // Step 1: remove soft line breaks (=\r\n or =\n).
  const withoutSoftBreaks = text.replace(/=\r?\n/g, '');

  // Step 2: collect contiguous runs of =XX tokens so we can decode them as a
  // single UTF-8 byte sequence.  Non-encoded characters are passed through
  // verbatim between runs.
  return withoutSoftBreaks.replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) => {
    // Convert each =XX in this contiguous run to a %XX percent-encoded byte.
    const percentEncoded = run.replace(/=([0-9A-Fa-f]{2})/g, '%$1');
    try {
      return decodeURIComponent(percentEncoded);
    } catch {
      // If the byte sequence is not valid UTF-8, fall back to individual
      // Latin-1 character decoding so no data is lost.
      return run.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }
  });
}
