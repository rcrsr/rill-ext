/**
 * Pure helpers for Unicode normalisation and character manipulation.
 *
 * No external dependencies — uses `String.prototype.normalize` built-in (TD-6).
 *
 * @module
 */

/**
 * Remove diacritical marks (accents, cedillas, etc.) from `text`.
 *
 * Implementation (TD-6):
 *   1. Decompose to NFD (Normalization Form D) — base characters and
 *      combining marks become separate code points.
 *   2. Strip every combining mark (Unicode category `M`) via the
 *      `/\p{M}+/gu` regex.
 *
 * ASCII-only input is returned unchanged because no combining marks are
 * produced by NFD decomposition of ASCII characters (AC-38).
 *
 * Examples:
 *   stripDiacritics('café')  → 'cafe'  (AC-10)
 *   stripDiacritics('hello') → 'hello' (AC-38)
 */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '');
}
