/**
 * Param grammar parser for rill prompt YAML frontmatter.
 *
 * Parses a single `params` list entry of the form:
 *   name: type
 *   name: type = default
 *
 * Covers IR-3, EC-3, EC-4.
 *
 * Type parsing is delegated to rill's public parser (tokenize +
 * createParserState + parseTypeRef), then adapted via typeRefToStructure.
 * Rejections enforced by typeRefToStructure: dynamic $T refs, union types
 * (A | B), and unsupported parameterizations (e.g. tuple(T)). The legacy
 * aliases `num` and `callable` are rejected by rill's parser since they are
 * not valid rill type names.
 */

import {
  RuntimeError,
  tokenize,
  createParserState,
  parseTypeRef,
  type RillParam,
  type TypeStructure,
} from '@rcrsr/rill';
import { typeRefToStructure } from './typeRefToStructure.js';

// ============================================================
// NAME VALIDATION
// ============================================================

function validateName(name: string): void {
  if (name === '') {
    throw new RuntimeError('RILL-R001', 'param name must not be empty');
  }
  if (/\s/.test(name)) {
    throw new RuntimeError('RILL-R001', 'param name must be a valid identifier');
  }
}

// ============================================================
// PARSER
// ============================================================

/**
 * Parses a single param grammar entry from a YAML `params` list.
 *
 * Supported forms:
 *   - `name: type`
 *   - `name: type = default`
 *
 * The type portion is any static rill type expression accepted by rill's
 * parseTypeRef. Examples: `string`, `number`, `bool`, `dict`, `list`,
 * `any`, `list(string)`, `dict(a: string, b: number)`.
 *
 * Note: `num` and `callable` are NOT accepted (not valid rill type names).
 * Dynamic refs ($T) and unions (A | B) are rejected by typeRefToStructure.
 * Non-renderable types (`closure`, `iterator`, `stream`, `vector`, `type`)
 * are rejected — their `formatValue` output is placeholder text with no
 * useful meaning in a prompt.
 * Defaults remain scalar-only in v0 (string, number, bool).
 *
 * @param entry - A single entry string from the params list
 * @returns A fully-formed RillParam
 * @throws RuntimeError RILL-R001 if entry is malformed or type is unrecognized
 */
export function parseParamGrammar(entry: string): RillParam {
  // EC-3: no `:` separator
  const colonIdx = entry.indexOf(':');
  if (colonIdx === -1) {
    throw new RuntimeError(
      'RILL-R001',
      `malformed param entry — expected "name: type" or "name: type = default", got: "${entry}"`,
    );
  }

  const name = entry.slice(0, colonIdx).trim();
  validateName(name);
  const rest = entry.slice(colonIdx + 1).trim();

  // Depth-aware split on the first top-level '='.
  let eqIdx = -1;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '=' && depth === 0) {
      eqIdx = i;
      break;
    }
  }
  const typeExpr = (eqIdx === -1 ? rest : rest.slice(0, eqIdx)).trim();
  const rawDefault = eqIdx === -1 ? undefined : rest.slice(eqIdx + 1).trim();

  // Delegate type parsing to rill.
  let structure: TypeStructure;
  try {
    const tokens = tokenize(typeExpr);
    const state = createParserState(tokens);
    const ref = parseTypeRef(state);
    structure = typeRefToStructure(ref);
  } catch (err) {
    if (err instanceof RuntimeError) throw err;
    throw new RuntimeError(
      'RILL-R001',
      `failed to parse param type "${typeExpr}": ${String((err as Error).message ?? err)}`,
    );
  }

  const defaultValue = rawDefault === undefined ? undefined : coerceDefault(name, structure, rawDefault);

  return {
    name,
    type: structure,
    defaultValue,
    annotations: {},
  };
}

// ============================================================
// DEFAULT COERCION
// ============================================================

/**
 * Coerces a raw default string (from `= default` suffix) to a RillValue.
 * Only supports defaults on scalar types in v0 (string, number, bool).
 * Rejects defaults on list/dict/closure/any with RILL-R001.
 */
function coerceDefault(
  name: string,
  structure: TypeStructure,
  raw: string,
): string | number | boolean {
  if (structure.kind === 'string') {
    // Strip surrounding quotes if present; otherwise use verbatim.
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  if (structure.kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new RuntimeError(
        'RILL-R001',
        `default value for number param "${name}" is not a valid number: "${raw}"`,
      );
    }
    return n;
  }
  if (structure.kind === 'bool') {
    if (raw !== 'true' && raw !== 'false') {
      throw new RuntimeError(
        'RILL-R001',
        `default value for bool param "${name}" must be "true" or "false", got: "${raw}"`,
      );
    }
    return raw === 'true';
  }
  throw new RuntimeError(
    'RILL-R001',
    `defaults for param type "${structure.kind}" are not supported in v0 (param: "${name}")`,
  );
}
