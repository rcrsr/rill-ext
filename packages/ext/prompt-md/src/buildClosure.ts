/**
 * Closure builder for parsed prompt files.
 *
 * Converts a ParsedPrompt into an ApplicationCallable that:
 * - Accepts named args matching the declared RillParam list
 * - Interpolates {name} placeholders in the body
 * - Returns a rill string (output: 'string') or rill list of role dicts (output: 'list')
 */

import {
  formatValue,
  RuntimeError,
  structureToTypeValue,
  toCallable,
  type ApplicationCallable,
  type CallableFn,
  type RillTypeValue,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
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
// RETURN TYPES
// ============================================================

/** Return type for `output: 'string'` prompts: a plain rill string. */
const STRING_RETURN_TYPE: RillTypeValue = structureToTypeValue({
  kind: 'string',
});

/**
 * Return type for `output: 'list'` prompts: `list(dict(role: string, content: string))`.
 *
 * Matches the shape produced by `splitRoleMessages` and accepted by every LLM
 * extension's `message()` call when passed a list input (sugar expansion via
 * `normalizePrompt`).
 */
const MESSAGE_LIST_RETURN_TYPE: RillTypeValue = structureToTypeValue({
  kind: 'list',
  element: {
    kind: 'dict',
    fields: {
      role: { type: { kind: 'string' } },
      content: { type: { kind: 'string' } },
    },
  },
});

// ============================================================
// BUILD CLOSURE
// ============================================================

/**
 * Builds an ApplicationCallable from a fully validated ParsedPrompt.
 *
 * Annotations attached to the callable:
 *   ^id          — resolution name (rill string)
 *   ^hash        — SHA-256 hex digest of canonical content (rill string)
 *   ^description — human-readable description (rill string)
 *   ^input       — ordered list of { name, type } dicts derived from params
 *   ^output      — 'string' or 'list' (rill string)
 *
 * The closure fn:
 *   - Coerces values via `formatValue` from `@rcrsr/rill` (rill's canonical stringifier).
 *   - Re-throws existing RuntimeErrors as-is (factory-time RILL-R001 paths).
 * - Wraps any other uncaught error via `ctx.invalidate(err, { code: 'PROTOCOL', provider: 'prompt-md', raw: { kind: 'closure_failure', ... } })`.
 *
 * @param parsed - Fully validated ParsedPrompt from parseFile.
 * @returns An ApplicationCallable wrapping the prompt logic.
 */
export function buildClosure(parsed: ParsedPrompt): ApplicationCallable {
  // ── Build ^input annotation: ordered list of { name, type } dicts ────────
  const inputList: RillValue[] = parsed.params.map((param) => {
    const typeLabel: string =
      param.type === undefined ? 'any' : param.type.kind;
    return { name: param.name, type: typeLabel } as Record<string, RillValue>;
  });

  // ── Annotations dict ────────────────────────────────────────
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

      // Produce output shape based on declared output type.
      if (parsed.output === 'string') {
        // Plain string output has no role structure; interpolate the whole body.
        return interpolate(parsed.body, values);
      }

      // output === 'list': split the TEMPLATE into @@ role messages FIRST, then
      // interpolate within each message's content. Splitting before
      // interpolation stops an arg value that contains a "@@ role" line from
      // injecting a new message (e.g. a smuggled system prompt). parseFile
      // guarantees at least one marker exists, so splitRoleMessages will not
      // throw RILL-R001 here.
      const templateMessages = splitRoleMessages(parsed.body);
      return templateMessages.map(({ role, content }) => ({
        role,
        content: interpolate(content, values),
      })) as RillValue[];
    } catch (err) {
      // Re-throw RuntimeErrors as-is (any RILL-R001 propagated from splitRoleMessages).
      if (err instanceof RuntimeError) {
        throw err;
      }
      // Closure-runtime failure: invalidate via ctx with #PROTOCOL.
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
  // returnType is concrete: `string` for plain prompts, `list(dict(role, content))`
  // for prompts whose body contains `@@ role` markers. No longer `any`.
  return toCallable({
    params: parsed.params,
    fn,
    annotations,
    returnType:
      parsed.output === 'list' ? MESSAGE_LIST_RETURN_TYPE : STRING_RETURN_TYPE,
  });
}
