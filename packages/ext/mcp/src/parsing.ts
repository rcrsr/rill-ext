/**
 * JSON Schema to rill type mapping utilities.
 *
 * Converts MCP tool JSON Schema definitions to rill RillParam arrays.
 */

import type {
  RillFieldDef,
  RillParam,
  RillValue,
  TypeStructure,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';

// ============================================================
// JSON SCHEMA TYPES
// ============================================================

/**
 * JSON Schema property definition (subset used by MCP).
 */
export interface JsonSchemaProperty {
  readonly type?:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly unknown[] | undefined;
  readonly oneOf?: readonly unknown[] | undefined;
  readonly anyOf?: readonly unknown[] | undefined;
}

/**
 * JSON Schema object definition.
 */
export interface JsonSchema {
  readonly type?: 'object' | undefined;
  readonly properties?: Record<string, JsonSchemaProperty> | undefined;
  readonly required?: readonly string[] | undefined;
}

/**
 * JSON Schema definition for any value (not restricted to top-level objects).
 *
 * Used for MCP outputSchema fields which may represent any JSON Schema type,
 * including primitives, arrays, and objects with nested structure.
 */
export interface OutputJsonSchema {
  readonly type?:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | undefined;
  readonly properties?: Record<string, JsonSchemaProperty> | undefined;
  readonly items?: OutputJsonSchema | undefined;
  readonly required?: readonly string[] | undefined;
  readonly description?: string | undefined;
  readonly enum?: readonly unknown[] | undefined;
  readonly oneOf?: readonly unknown[] | undefined;
  readonly anyOf?: readonly unknown[] | undefined;
}

// ============================================================
// TYPE MAPPING
// ============================================================

/** Rill type names used for JSON Schema mapping. */
export type RillTypeName =
  | 'string'
  | 'number'
  | 'bool'
  | 'dict'
  | 'list'
  | 'vector'
  | 'any';

/**
 * Maps JSON Schema type to rill type name.
 *
 * Mapping rules:
 * - `string` → `string`
 * - `integer` → `number` (rill has no int/float distinction)
 * - `number` → `number`
 * - `boolean` → `bool`
 * - `object` → `dict`
 * - `array` → `list`
 * - enum/oneOf/anyOf → `string` (fallback; host validates)
 * - missing/unknown → `dict` (accept any value)
 *
 * @param property - JSON Schema property definition
 * @returns Rill type name string
 */
export function mapJsonSchemaTypeToRillType(
  property: JsonSchemaProperty
): RillTypeName {
  // Handle enum/oneOf/anyOf: fallback to string
  if (property.enum || property.oneOf || property.anyOf) {
    return 'string';
  }

  // Map JSON Schema type to rill type
  switch (property.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    case 'object':
      return 'dict';
    case 'array':
      return 'list';
    default:
      // Missing or unknown type: accept any value as dict
      return 'dict';
  }
}

/**
 * Returns type-appropriate default value for optional parameters.
 *
 * Default values by rill type:
 * - `string` → `""` (empty string)
 * - `number` → `0`
 * - `bool` → `false`
 * - `list` → `[]` (empty array)
 * - `dict` → `{}` (empty object)
 * - `vector` → `[]` (empty array)
 * - `any` → `{}` (empty object)
 *
 * @param type - Rill type
 * @returns Default value for the type
 */
export function getDefaultValueForType(type: RillTypeName): RillValue {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'bool':
      return false;
    case 'list':
    case 'vector':
      return [];
    case 'dict':
    case 'any':
      return {};
  }
}

/**
 * Sanitizes parameter name to valid rill identifier.
 *
 * Rules:
 * - Replace `-` with `_`
 * - Replace `.` with `_`
 * - Convert camelCase to snake_case
 * - Convert PascalCase to snake_case
 * - Normalize consecutive underscores to single underscore
 * - Strip leading and trailing underscores
 *
 * @param name - Original parameter name
 * @returns Sanitized rill identifier
 */
export function sanitizeParameterName(name: string): string {
  // Replace hyphens and dots with underscores
  let sanitized = name.replace(/[-.]/g, '_');

  // Convert camelCase and PascalCase to snake_case
  sanitized = sanitized
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

  // Normalize underscores: collapse consecutive and strip leading/trailing
  sanitized = sanitized.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

  return sanitized;
}

// ============================================================
// OUTPUT SCHEMA CONVERSION
// ============================================================

/**
 * Converts an OutputJsonSchema to a rill TypeStructure.
 *
 * Mapping rules:
 * - `enum` / `oneOf` / `anyOf` present → `{ kind: 'any' }`
 * - `type: 'string'` → `{ kind: 'string' }`
 * - `type: 'number' | 'integer'` → `{ kind: 'number' }`
 * - `type: 'boolean'` → `{ kind: 'bool' }`
 * - `type: 'array'` with `items` → `{ kind: 'list', element: jsonSchemaToTypeStructure(items) }`
 * - `type: 'array'` without `items` → `{ kind: 'list' }`
 * - `type: 'object'` with `properties` → `{ kind: 'dict', fields: { [name]: { type: ... } } }`
 * - `type: 'object'` without `properties` → `{ kind: 'dict' }`
 * - missing/unknown → `{ kind: 'any' }`
 *
 * @param schema - JSON Schema definition for any value type
 * @returns TypeStructure representing the schema in the rill type system
 */
export function jsonSchemaToTypeStructure(
  schema: OutputJsonSchema
): TypeStructure {
  // enum/oneOf/anyOf: fall back to any (value is not structurally typed)
  if (schema.enum || schema.oneOf || schema.anyOf) {
    return { kind: 'any' };
  }

  switch (schema.type) {
    case 'string':
      return { kind: 'string' };
    case 'number':
    case 'integer':
      return { kind: 'number' };
    case 'boolean':
      return { kind: 'bool' };
    case 'array':
      if (schema.items !== undefined) {
        return {
          kind: 'list',
          element: jsonSchemaToTypeStructure(schema.items),
        };
      }
      return { kind: 'list' };
    case 'object': {
      if (schema.properties !== undefined) {
        const fields: Record<string, RillFieldDef> = {};
        for (const [name, prop] of Object.entries(schema.properties)) {
          fields[name] = { type: jsonSchemaToTypeStructure(prop) };
        }
        return { kind: 'dict', fields };
      }
      return { kind: 'dict' };
    }
    default:
      return { kind: 'any' };
  }
}

// ============================================================
// PARAMETER GENERATION
// ============================================================

/**
 * Converts a single JSON Schema property to a RillParam.
 *
 * Maps the JSON Schema type to the correct rill type via `mapJsonSchemaTypeToRillType`,
 * then dispatches to the matching `p.*` helper. All params get `defaultValue: undefined`
 * (callers handle required/optional semantics).
 *
 * Portable utility: can be extracted to core without MCP-specific dependencies.
 *
 * @param name - Sanitized parameter name
 * @param property - JSON Schema property definition
 * @returns RillParam with correct rill type
 */
export function jsonSchemaPropertyToRillParam(
  name: string,
  property: JsonSchemaProperty
): RillParam {
  const rillType = mapJsonSchemaTypeToRillType(property);
  const desc = property.description;

  switch (rillType) {
    case 'number':
      return p.num(name, desc);
    case 'bool':
      return p.bool(name, desc);
    case 'dict':
      return p.dict(name, desc);
    case 'list':
      return p.list(name, undefined, desc);
    case 'string':
    default:
      return p.str(name, desc);
  }
}

/**
 * Generates rill RillParam array from JSON Schema.
 *
 * Rules:
 * - Each `properties` entry → one RillParam
 * - Property key → `name` (sanitized)
 * - Type mapped via `jsonSchemaPropertyToRillParam` (string→str, number/integer→num, etc.)
 * - `properties[key].description` → `annotations.description`
 * - Order: `Object.entries(properties)` iteration order
 * - Missing `properties` → empty array
 *
 * @param schema - JSON Schema object definition
 * @returns Array of RillParam
 */
export function generateParametersFromSchema(schema: JsonSchema): RillParam[] {
  // Missing properties: return empty array
  if (!schema.properties) {
    return [];
  }

  const params: RillParam[] = [];

  // Iterate properties in Object.entries order
  for (const [key, property] of Object.entries(schema.properties)) {
    const sanitizedName = sanitizeParameterName(key);
    params.push(jsonSchemaPropertyToRillParam(sanitizedName, property));
  }

  return params;
}

// ============================================================
// RESOURCE CONTENT PARSING
// ============================================================

/**
 * MCP resource content block (single item in contents array).
 */
interface ResourceContentBlock {
  readonly uri: string;
  readonly text?: string | undefined;
  readonly blob?: string | undefined; // base64
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result.
 */
export interface ResourceReadResult {
  readonly contents: ResourceContentBlock[];
}

/**
 * Parses single resource content block to rill value.
 *
 * Rules:
 * - Text content: return as string; if valid JSON, parse to dict
 * - Blob content: return dict `{ type: "image", data: base64, mime: mimeType }`
 * - Empty content (zero bytes): return empty string `""`
 *
 * @param block - Single MCP resource content block
 * @returns Rill value (string or dict)
 */
function parseResourceContentBlock(block: ResourceContentBlock): RillValue {
  // Text content: try parsing as JSON, otherwise return as string
  if (block.text !== undefined) {
    const text = block.text;

    // Empty text content returns empty string
    if (text.length === 0) {
      return '';
    }

    // Try parsing as JSON
    try {
      const parsed = JSON.parse(text);
      // JSON successfully parsed: return as dict if object, otherwise as-is
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as { [key: string]: RillValue };
      }
      return parsed;
    } catch {
      // Not JSON: return as plain string
      return text;
    }
  }

  // Blob content: return structured dict
  if (block.blob !== undefined) {
    return {
      type: 'image',
      data: block.blob,
      mime: block.mimeType ?? 'application/octet-stream',
    };
  }

  // No text or blob content (zero bytes): return empty string
  return '';
}

/**
 * Parses MCP resource read result content to rill value.
 *
 * Rules (Task 3.2):
 * - Empty content array → return empty string `""`
 * - Single text block with JSON → parse to dict
 * - Single text block (non-JSON) → return string
 * - Single blob block → dict with `{ type: "image", data: base64, mime: mimeType }`
 * - Multiple text blocks → concatenate with newlines
 * - Multiple blocks with blobs → return first content block only
 *
 * @param result - MCP resource read result with contents array
 * @returns Rill value (string, dict, or structured content)
 */
export function parseResourceContent(result: ResourceReadResult): RillValue {
  const { contents } = result;

  // Empty content: return empty string
  if (contents.length === 0) {
    return '';
  }

  // Single content block: apply type-specific parsing
  if (contents.length === 1) {
    return parseResourceContentBlock(contents[0]!);
  }

  // Multiple content blocks: check if all are text
  const allText = contents.every((block) => block.text !== undefined);

  if (allText) {
    // Concatenate text blocks with newlines
    return contents.map((block) => block.text ?? '').join('\n');
  }

  // Mixed or multiple blob blocks: return first content block
  return parseResourceContentBlock(contents[0]!);
}
