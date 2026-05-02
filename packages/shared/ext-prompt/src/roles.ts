/**
 * Role message splitter for rill prompt files.
 *
 * Splits a prompt body on `@@ role` marker lines into an ordered list
 * of `{ role, content }` objects. Only `^@@ (\w+)$` lines act as
 * role markers, comma, interior `##` headings are preserved as body text.
 *
 * `VALID_ROLES` is the role allowlist enforced for prompt-md role markers
 * by `splitRoleMessages`. Validation runs every time the prompt-md
 * closure is invoked, not at extension factory time, because the markdown
 * body is parsed on each call.
 *
 * The LLM extension `message()` host function uses an equivalent allowlist
 * defined in `@rcrsr/rill-ext-llm-shared/prompt.ts` (`assertBoundaryRoles`).
 * The two allowlists are kept in sync by convention; this module is not
 * yet a runtime single source of truth for the LLM extensions.
 *
 * The allowlist is `['system', 'user', 'assistant']` as a readonly tuple.
 * Any role string outside this set is rejected with `RILL-R001` here
 * (prompt-md path) or `#INVALID_INPUT / invalid_role` at the LLM extension
 * boundary.
 *
 * Throws RuntimeError RILL-R001 when no role markers are found, or when
 * a role marker references a role not in VALID_ROLES.
 */

import { RuntimeError } from '@rcrsr/rill';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Roles accepted by `splitRoleMessages` for prompt-md `@@ role` markers.
 *
 * Enforced on every closure invocation, not at extension factory time.
 * `@rcrsr/rill-ext-llm-shared/prompt.ts` declares an equivalent allowlist
 * for `message()` inputs and is kept in sync with this tuple by convention.
 * Any value not in this tuple is rejected.
 */
export const VALID_ROLES = ['system', 'user', 'assistant'] as const;

/** Union type of valid role strings. */
export type Role = (typeof VALID_ROLES)[number];

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
 * Any text before the first `@@ role` marker is emitted as a leading
 * entry with role `user` (the documented default).
 *
 * Interior `##` markdown headings are not treated as role markers and
 * remain part of the enclosing role's content (AC-19).
 *
 * @throws RuntimeError RILL-R001 when no `@@ role` markers appear (EC-5)
 * @throws RuntimeError RILL-R001 when a marker role is not in VALID_ROLES (EC-23)
 */
export function splitRoleMessages(body: string): RoleMessage[] {
  const lines = body.split('\n');
  const messages: RoleMessage[] = [];

  let currentRole: string | null = null;
  let currentLines: string[] = [];
  let sawMarker = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const match = ROLE_MARKER_RE.exec(line);
    if (match !== null) {
      const role = match[1] as string;
      const lineNumber = i + 1; // 1-based

      // EC-23: validate role against allowlist after marker extraction
      if (!(VALID_ROLES as readonly string[]).includes(role)) {
        throw new RuntimeError(
          'RILL-R001',
          `Invalid role marker '@@ ${role}' at line ${lineNumber}. Valid roles are: system, user, assistant.`,
        );
      }

      if (currentRole !== null) {
        messages.push({ role: currentRole, content: currentLines.join('\n') });
      } else if (currentLines.length > 0 && currentLines.some((l) => l.length > 0)) {
        messages.push({ role: 'user', content: currentLines.join('\n') });
      }
      currentRole = role;
      currentLines = [];
      sawMarker = true;
    } else {
      currentLines.push(line);
    }
  }

  // EC-5: no role markers found
  if (!sawMarker) {
    throw new RuntimeError(
      'RILL-R001',
      'prompt body must contain at least one role marker (@@ role)',
    );
  }

  // Flush the final role entry
  messages.push({ role: currentRole as string, content: currentLines.join('\n') });

  return messages;
}
