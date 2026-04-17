/**
 * Role message splitter for rill prompt files.
 *
 * Splits a prompt body on `@@ role` marker lines into an ordered list
 * of `{ role, content }` objects. Only `^@@ (\w+)$` lines act as
 * role markers — interior `##` headings are preserved as body text.
 *
 * Throws RuntimeError RILL-R001 when no role markers are found.
 */

import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// TYPES
// ============================================================

export interface RoleMessage {
  role: string;
  content: string;
}

// ============================================================
// ROLE MARKER REGEX
// ============================================================

/** Matches lines of the form `@@ word` with optional surrounding whitespace. */
const ROLE_MARKER_RE = /^@@\s+(\w+)\s*$/;

// ============================================================
// SPLIT ROLE MESSAGES
// ============================================================

/**
 * Splits a prompt body string on `@@ role` marker lines.
 *
 * Each role marker starts a new `{ role, content }` entry. The content
 * for each role is all lines between that marker and the next marker (or
 * EOF), joined verbatim (no trimming).
 *
 * Interior `##` markdown headings are not treated as role markers and
 * remain part of the enclosing role's content (AC-19).
 *
 * @throws RuntimeError RILL-R001 when no `@@ role` markers appear (EC-5)
 */
export function splitRoleMessages(body: string): RoleMessage[] {
  const lines = body.split('\n');
  const messages: RoleMessage[] = [];

  let currentRole: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = ROLE_MARKER_RE.exec(line);
    if (match !== null) {
      // Flush the previous role entry before starting a new one
      if (currentRole !== null) {
        messages.push({ role: currentRole, content: currentLines.join('\n') });
      }
      currentRole = match[1] as string;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // EC-5: no role markers found
  if (currentRole === null) {
    throw new RuntimeError(
      'RILL-R001',
      'prompt body must contain at least one role marker (@@ role)',
    );
  }

  // Flush the final role entry
  messages.push({ role: currentRole, content: currentLines.join('\n') });

  return messages;
}
