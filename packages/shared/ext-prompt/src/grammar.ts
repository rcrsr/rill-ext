/**
 * Param grammar parser for rill prompt YAML frontmatter.
 *
 * Parses a single `params` list entry of the form:
 *   name: type
 *   name: type = default
 *
 * Dispatches to p.* helpers from @rcrsr/rill-ext-param-shared.
 * Covers IR-3, EC-3, EC-4.
 */

import { RuntimeError, type RillParam } from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';

// ============================================================
// SUPPORTED TYPES
// ============================================================

const SUPPORTED_TYPES = ['string', 'num', 'bool', 'dict', 'list', 'callable'] as const;
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
  const rest = entry.slice(colonIdx + 1).trim();

  // Split rest on `=` to separate type from optional default
  const eqIdx = rest.indexOf('=');
  const typeName = (eqIdx === -1 ? rest : rest.slice(0, eqIdx)).trim();
  const rawDefault = eqIdx === -1 ? undefined : rest.slice(eqIdx + 1).trim();

  // EC-4: unrecognized type
  if (!isSupportedType(typeName)) {
    throw new RuntimeError(
      'RILL-R001',
      `unrecognized param type "${typeName}" — supported types: ${SUPPORTED_TYPES.join(', ')}`,
    );
  }

  return buildParam(name, typeName, rawDefault);
}

// ============================================================
// DISPATCHER
// ============================================================

function buildParam(name: string, typeName: SupportedType, rawDefault: string | undefined): RillParam {
  switch (typeName) {
    case 'string': {
      // p.str has no default parameter — overwrite defaultValue when a default is provided
      const param = p.str(name);
      if (rawDefault !== undefined) {
        return { ...param, defaultValue: rawDefault };
      }
      return param;
    }

    case 'num': {
      if (rawDefault !== undefined) {
        const parsed = Number(rawDefault);
        if (!Number.isFinite(parsed)) {
          throw new RuntimeError(
            'RILL-R001',
            `default value for num param "${name}" is not a valid number: "${rawDefault}"`,
          );
        }
        return p.num(name, undefined, parsed);
      }
      return p.num(name);
    }

    case 'bool': {
      if (rawDefault !== undefined) {
        if (rawDefault !== 'true' && rawDefault !== 'false') {
          throw new RuntimeError(
            'RILL-R001',
            `default value for bool param "${name}" must be "true" or "false", got: "${rawDefault}"`,
          );
        }
        return p.bool(name, undefined, rawDefault === 'true');
      }
      return p.bool(name);
    }

    case 'dict': {
      if (rawDefault !== undefined) {
        throw new RuntimeError(
          'RILL-R001',
          `defaults for dict params are not supported in v0 (param: "${name}")`,
        );
      }
      return p.dict(name);
    }

    case 'list': {
      if (rawDefault !== undefined) {
        throw new RuntimeError(
          'RILL-R001',
          `defaults for list params are not supported in v0 (param: "${name}")`,
        );
      }
      return p.list(name);
    }

    case 'callable': {
      if (rawDefault !== undefined) {
        throw new RuntimeError(
          'RILL-R001',
          `defaults for callable params are not supported (param: "${name}")`,
        );
      }
      return p.callable(name);
    }
  }
}
