/**
 * Content hash computation for rill prompt definitions.
 *
 * Covers IR-6, AC-18 (hash stability).
 *
 * Uses node:crypto inline — does NOT import @rcrsr/rill-ext-crypto (§EXT.2.1).
 */

import { createHash } from 'node:crypto';

// ============================================================
// COMPUTE CONTENT HASH
// ============================================================

/**
 * Returns a hex SHA-256 digest of `(params + "\n" + output + "\n" + body)`.
 *
 * Byte-identical inputs always produce the same 64-character lowercase hex
 * string. Never throws.
 */
export function computeContentHash(
  params: string,
  output: string,
  body: string
): string {
  return createHash('sha256')
    .update(`${params}\n${output}\n${body}`)
    .digest('hex');
}
