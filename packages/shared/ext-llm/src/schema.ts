/**
 * JSON Schema builder for rill type descriptors.
 *
 * Converts rill schema definitions into JSON Schema objects suitable for
 * LLM tool definitions.
 */

import {
  type TypeStructure,
  type RillParam,
  RuntimeError,
} from '@rcrsr/rill';

type ListTypeStructure = Extract<TypeStructure, { kind: 'list' }>;
type DictTypeStructure = Extract<TypeStructure, { kind: 'dict' }>;
type ClosureTypeStructure = Extract<TypeStructure, { kind: 'closure' }>;

/**
 * Represents an individual JSON Schema property descriptor.
 *
 * Covers all supported forms:
 * - Simple typed property: `{ type: "string" }`
 * - Typed with description: `{ type: "string", description: "..." }`
 * - Array with items: `{ type: "array", items: JsonSchemaProperty }`
 * - Object with properties: `{ type: "object", properties: Record<string, JsonSchemaProperty> }`
 * - Enum constraint: `{ type: "string", enum: string[] }`
 */
export interface JsonSchemaProperty {
  type?: string | undefined;
  description?: string | undefined;
  items?: JsonSchemaProperty | undefined;
  properties?: Record<string, JsonSchemaProperty> | undefined;
  required?: string[] | undefined;
  enum?: string[] | undefined;
  additionalProperties?: false | undefined;
}

/**
 * Represents a JSON Schema object (top-level tool parameter schema).
 */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

/** Map from rill type names to JSON Schema type strings. */
const RILL_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  list: 'array',
  dict: 'object',
  vector: 'object',
  shape: 'object',
};

/**
 * Convert a rill type name to the corresponding JSON Schema type string.
 * Throws RuntimeError RILL-R005 for unsupported types.
 */
export function mapRillType(rillType: string): string {
  const jsonType = RILL_TYPE_MAP[rillType];
  if (jsonType === undefined) {
    throw new RuntimeError('RILL-R005', `unsupported type: ${rillType}`);
  }
  return jsonType;
}

/**
 * Build a JsonSchemaProperty from a RillType in param position.
 *
 * - closure and tuple types throw RuntimeError RILL-R005 (EC-3).
 * - any type produces an unconstrained property (no type field).
 * - list type maps to array, recursing into element if present (AC-25).
 * - dict type maps to object.
 * - primitive types (string, number, bool) map via mapRillType.
 */
function buildPropertyFromStructuralType(rillType: TypeStructure): JsonSchemaProperty {
  if (rillType.kind === 'closure' || rillType.kind === 'tuple') {
    throw new RuntimeError(
      'RILL-R005',
      `unsupported type for JSON Schema: ${rillType.kind}`
    );
  }

  if (rillType.kind === 'any') {
    return {};
  }

  if (rillType.kind === 'list') {
    const listType = rillType as ListTypeStructure;
    const property: JsonSchemaProperty = { type: 'array' };
    if (listType.element !== undefined) {
      property.items = buildPropertyFromStructuralType(listType.element);
    }
    return property;
  }

  if (rillType.kind === 'dict') {
    const dictType = rillType as DictTypeStructure;
    if (dictType.fields && Object.keys(dictType.fields).length > 0) {
      const nested = buildDictSchema(dictType);
      return {
        type: 'object',
        properties: nested.properties,
        required: nested.required,
        additionalProperties: false,
      };
    }
    return { type: 'object', additionalProperties: false };
  }

  // string, number, bool, vector, shape — map through RILL_TYPE_MAP; unsupported types throw
  return { type: mapRillType(rillType.kind) };
}

/**
 * Build a JSON Schema object from a dict TypeStructure with named fields.
 *
 * Iterates dict.fields (Record<string, RillFieldDef>).
 * - Field description from fieldDef.annotations?.['description'].
 * - Fields without defaultValue are required.
 * - Recurses into nested dicts and lists.
 */
function buildDictSchema(dictType: DictTypeStructure): JsonSchemaObject {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  const fields = dictType.fields ?? {};

  for (const [name, fieldDef] of Object.entries(fields)) {
    const property = buildPropertyFromStructuralType(fieldDef.type);

    // Description from .^description annotation
    const description = fieldDef.annotations?.['description'];
    if (typeof description === 'string') {
      property.description = description;
    }

    properties[name] = property;

    // Fields without a defaultValue are required
    if (fieldDef.defaultValue === undefined) {
      required.push(name);
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * Build a JSON Schema object from a TypeStructure.
 *
 * Supports two variants:
 *
 * **dict** — for generate() structured output:
 * - Iterates type.fields (Record<string, RillFieldDef>).
 * - Field descriptions from fieldDef.annotations?.['description'].
 * - Fields without defaultValue are required.
 *
 * **closure** — for tool_loop() tool parameters:
 * - Iterates type.params (array of RillFieldDef).
 * - Matches each entry to params[i] by position for metadata.
 * - annotations.description from rillParam.annotations['description'].
 * - annotations.enum from rillParam.annotations['enum'].
 * - optional = rillParam.defaultValue !== undefined.
 * - Non-optional params added to required[].
 *
 * @throws RuntimeError RILL-R005 for unsupported top-level kind
 * @throws RuntimeError RILL-R005 for closure/tuple type in param position (EC-3)
 * @throws RuntimeError RILL-R005 for unsupported type name (EC-3)
 */
export function buildJsonSchemaFromStructuralType(
  type: TypeStructure,
  params?: RillParam[]
): JsonSchemaObject {
  if (type.kind === 'dict') {
    return buildDictSchema(type as DictTypeStructure);
  }

  if (type.kind !== 'closure') {
    throw new RuntimeError(
      'RILL-R005',
      `unsupported schema kind: ${type.kind} (expected dict or closure)`
    );
  }

  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  const closureParams = (type as ClosureTypeStructure).params ?? [];

  for (let i = 0; i < closureParams.length; i++) {
    const fieldDef = closureParams[i]!;
    const paramName = fieldDef.name ?? `param${i}`;
    const paramType = fieldDef.type;
    const rillParam = params?.[i];

    const property = buildPropertyFromStructuralType(paramType);

    // Map annotations.description
    const description = rillParam?.annotations['description'];
    if (typeof description === 'string') {
      property.description = description;
    }

    // Map annotations.enum (stored as RillValue — a JS array)
    const enumAnnotation = rillParam?.annotations['enum'];
    if (Array.isArray(enumAnnotation)) {
      property.enum = enumAnnotation as string[];
    }

    properties[paramName] = property;

    // Params without a defaultValue are required (defaultValue === undefined means required)
    if (rillParam === undefined || rillParam.defaultValue === undefined) {
      required.push(paramName);
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

