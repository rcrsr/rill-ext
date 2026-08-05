/**
 * Pure helpers for URL and email extraction using linkify-it.
 *
 * linkify-it is instantiated once at module load to avoid
 * repeated compilation of internal regular expressions.
 *
 * Match shape (linkify-it v5):
 *   { schema, index, lastIndex, raw, text, url }
 *
 * Schema values:
 *   'http:'  / 'https:' / 'ftp:' / 'ftps:' — explicit-protocol URLs
 *   ''                                        — fuzzy bare hostnames
 *   'mailto:'                                 — emails (fuzzy or explicit)
 *
 * @module
 */

import LinkifyIt from 'linkify-it';

/** Linkify-it instance shared across all calls in this module. */
const linkifier = new LinkifyIt();

/**
 * Extract all URLs from `text` and return them as a list of strings.
 *
 * Includes both explicit-protocol URLs (`http:`, `https:`, `ftp:`,
 * `ftps:`) and fuzzy bare-hostname matches (`schema === ''`).
 * Excludes email addresses (`schema === 'mailto:'`).
 *
 * Returns `[]` when no matches are found.
 *
 * Examples:
 * extractUrls('Visit https://example.com for info') → ['https://example.com']
 * extractUrls('plain text') → []
 */
export function extractUrls(text: string): string[] {
  const matches = linkifier.match(text);
  if (matches === null) {
    return [];
  }
  return matches.filter((m) => m.schema !== 'mailto:').map((m) => m.url);
}

/**
 * Extract all email addresses from `text` and return them as a list.
 *
 * linkify-it surfaces emails with `schema === 'mailto:'`.  The `text`
 * field on the match already carries the bare address (e.g.
 * `'user@example.com'`), so no stripping is needed.
 *
 * Returns `[]` when no matches are found.
 *
 * Examples:
 * extractEmails('Contact user@example.com') → ['user@example.com']
 * extractEmails('plain text') → []
 */
export function extractEmails(text: string): string[] {
  const matches = linkifier.match(text);
  if (matches === null) {
    return [];
  }
  return matches.filter((m) => m.schema === 'mailto:').map((m) => m.text);
}
