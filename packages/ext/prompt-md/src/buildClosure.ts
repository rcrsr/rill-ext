/**
 * Closure builder for parsed prompt files.
 *
 * Converts a ParsedPrompt into an ApplicationCallable that:
 * - Accepts named args matching the declared RillParam list
 * - Interpolates {name} placeholders in the body
 * - Returns a rill string (output: 'string') or rill list of role dicts (output: 'list')
 *
 * Covers IR-9, AC-4, AC-14, EC-17.
 */

import { anyTypeValue, formatValue, RuntimeError, toCallable, type ApplicationCallable, type CallableFn, type RillValue, type RuntimeContext } from '@rcrsr/rill';
import {
  interpolate,
  splitRoleMessages,
  ANNOTATION_KEY_ID,
  ANNOTATION_KEY_HASH,
  ANNOTATION_KEY_INPUT,
  ANNOTATION_KEY_OUTPUT,
  ANNOTATION_KEY_DESCRIPTION,
} from '@rcrsr/rill-ext-prompt-shared';
import type { ParsedPrompt } from './parseFile.js';

// ============================================================
// BUILD CLOSURE
// ============================================================

/**
 * Builds an ApplicationCallable from a fully validated ParsedPrompt.
 *
 * Annotations attached to the callable (IR-9, AC-4):
 *   ^id          — resolution name (rill string)
 *   ^hash        — SHA-256 hex digest of canonical content (rill string)
 *   ^description — human-readable description (rill string)
 *   ^input       — ordered list of { name, type } dicts derived from params
 *   ^output      — 'string' or 'list' (rill string)
 *
 * The closure fn:
 *   - Coerces values via `formatValue` from `@rcrsr/rill` (rill's canonical stringifier).
 *   - Re-throws existing RuntimeErrors as-is (factory-time RILL-R001 paths).
 *   - Wraps any other uncaught error (EC-17) via `ctx.invalidate(err, { code: 'PROTOCOL', provider: 'prompt-md', raw: { kind: 'closure_failure', ... } })`.
 *
 * @param parsed - Fully validated ParsedPrompt from parseFile.
 * @returns An ApplicationCallable wrapping the prompt logic.
 */
export function buildClosure(parsed: ParsedPrompt): ApplicationCallable {
  // ── Build ^input annotation: ordered list of { name, type } dicts ────────
  const inputList: RillValue[] = parsed.params.map((param) => {
    const typeLabel: string = param.type === undefined ? 'any' : param.type.kind;
    return { name: param.name, type: typeLabel } as Record<string, RillValue>;
  });

  // ── Annotations dict (IR-9, AC-4) ────────────────────────────────────────
  const annotations: Record<string, RillValue> = {
    [ANNOTATION_KEY_ID]: parsed.name,
    [ANNOTATION_KEY_HASH]: parsed.hash,
    [ANNOTATION_KEY_DESCRIPTION]: parsed.description,
    [ANNOTATION_KEY_INPUT]: inputList,
    [ANNOTATION_KEY_OUTPUT]: parsed.output,
  };

  // ── Closure fn ────────────────────────────────────────────────────────────
  const fn: CallableFn = async (args, ctxLike): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;
    try {
      // Build interpolation values via rill's canonical formatValue; null/undefined → empty string.
      const values: Record<string, string> = {};
      for (const param of parsed.params) {
        const raw = args[param.name] as RillValue | undefined;
        // Missing arg treated as empty string (interpolate already handles '' for missing keys).
        if (raw === undefined || raw === null) {
          values[param.name] = '';
          continue;
        }
        values[param.name] = formatValue(raw);
      }

      // Interpolate body with resolved values.
      const interpolated = interpolate(parsed.body, values);

      // Produce output shape based on declared output type.
      if (parsed.output === 'string') {
        return interpolated;
      }

      // output === 'list': split on @@ role markers → list of { role, content } dicts.
      // parseFile guarantees at least one marker exists (EC-14), so splitRoleMessages
      // will not throw RILL-R001 here.
      const messages = splitRoleMessages(interpolated);
      return messages.map(({ role, content }) => ({
        role,
        content,
      })) as RillValue[];
    } catch (err) {
      // Re-throw RuntimeErrors as-is (any RILL-R001 propagated from splitRoleMessages).
      if (err instanceof RuntimeError) {
        throw err;
      }
      // Closure-runtime failure (EC-17): invalidate via ctx with #PROTOCOL.
      throw ctx.invalidate(err, {
        code: 'PROTOCOL',
        provider: 'prompt-md',
        raw: {
          kind: 'closure_failure',
          name: parsed.name,
          detail: err instanceof Error ? err.message : String(err),
        },
      }) as unknown as RillValue;
    }
  };

  // ── Assemble RillFunction and wrap via toCallable ─────────────────────────
  return toCallable({
    params: parsed.params,
    fn,
    annotations,
    returnType: anyTypeValue,
  });
}
