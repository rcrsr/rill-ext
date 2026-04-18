/**
 * Param grammar parser for rill prompt YAML frontmatter.
 *
 * Parses a single `params` list entry of the form:
 *   name: type
 *   name: type = default
 *
 * Covers IR-3, EC-3, EC-4.
 *
 * NOTE: Full delegation to rill's tokenize + parseTypeRef API is blocked because
 * @rcrsr/rill@0.18.4 does not expose parseTypeRef / createParserState via its
 * top-level package exports field ("." only). This implementation maintains a
 * hand-maintained type whitelist using rill's canonical type names (number, not
 * num; closure, not callable). Parameterized types (list(T), dict(a: T, b: T))
 * are not yet supported; extend when rill exposes a parser subpath export.
 */

import { RuntimeError, type RillParam, type TypeStructure } from '@rcrsr/rill';

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
// SUPPORTED TYPES
// ============================================================

const SUPPORTED_TYPES = ['string', 'number', 'bool', 'dict', 'list', 'any', 'closure'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

function isSupportedType(value: string): value is SupportedType {
  return (SUPPORTED_TYPES as readonly string[]).includes(value);
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
 * The type portion must be one of: string, number, bool, dict, list, any, closure.
 * Note: `num` and `callable` are NOT accepted. Use `number` and `closure`.
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

  // Find the `=` that separates type-expr from default.
  // Track parentheses depth so we don't split on `=` inside future parameterized types.
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

  // EC-4: unrecognized type
  if (!isSupportedType(typeExpr)) {
    throw new RuntimeError(
      'RILL-R001',
      `unrecognized param type "${typeExpr}" — supported types: ${SUPPORTED_TYPES.join(', ')}`,
    );
  }

  const structure: TypeStructure = { kind: typeExpr } as TypeStructure;
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
