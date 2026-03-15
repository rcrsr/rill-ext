/**
 * Param builder utilities for rill extension host functions.
 *
 * Provides a `p` helper object with typed factory methods for building
 * RillParam descriptors used in extension host function parameter lists.
 */

import { RuntimeError, type RillFieldDef, type RillParam, type RillType, type RillValue } from '@rcrsr/rill';

// ============================================================
// NAME VALIDATION
// ============================================================

/**
 * Validates that a parameter name is a valid identifier.
 * Throws RuntimeError RILL-R001 if invalid.
 *
 * @param name - The parameter name to validate
 * @throws RuntimeError if name is empty or contains whitespace
 */
function validateParamName(name: string): void {
  // EC-1: empty name → RuntimeError RILL-R001: "param name must not be empty"
  if (name === '') {
    throw new RuntimeError('RILL-R001', 'param name must not be empty');
  }

  // EC-2: whitespace in name → RuntimeError RILL-R001: "param name must be a valid identifier"
  if (/\s/.test(name)) {
    throw new RuntimeError('RILL-R001', 'param name must be a valid identifier');
  }
}

// ============================================================
// ANNOTATION BUILDER
// ============================================================

function buildAnnotations(desc?: string): Record<string, RillValue> {
  if (desc !== undefined) {
    return { description: desc };
  }
  return {};
}

// ============================================================
// P HELPER OBJECT
// ============================================================

/**
 * Param builder helpers for defining host function parameters.
 *
 * Each method validates the name and returns a fully-formed RillParam.
 */
export const p = {
  /**
   * IR-1: Creates a string parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param desc - Optional description
   * @returns RillParam with type 'string'
   */
  str(name: string, desc?: string): RillParam {
    validateParamName(name);
    return {
      name,
      type: { type: 'string' },
      defaultValue: undefined,
      annotations: buildAnnotations(desc),
    };
  },

  /**
   * IR-2: Creates a number parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param desc - Optional description
   * @param def - Optional default value
   * @returns RillParam with type 'number'
   */
  num(name: string, desc?: string, def?: number): RillParam {
    validateParamName(name);
    return {
      name,
      type: { type: 'number' },
      defaultValue: def,
      annotations: buildAnnotations(desc),
    };
  },

  /**
   * IR-3: Creates a boolean parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param desc - Optional description
   * @param def - Optional default value
   * @returns RillParam with type 'bool'
   */
  bool(name: string, desc?: string, def?: boolean): RillParam {
    validateParamName(name);
    return {
      name,
      type: { type: 'bool' },
      defaultValue: def,
      annotations: buildAnnotations(desc),
    };
  },

  /**
   * IR-4: Creates a dict parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param desc - Optional description
   * @param def - Optional default value
   * @param fields - Optional structural field definitions (RillFieldDef with type and optional defaultValue)
   * @returns RillParam with type 'dict' (with fields if provided)
   */
  dict(name: string, desc?: string, def?: RillValue, fields?: Record<string, RillFieldDef>): RillParam {
    validateParamName(name);
    const type: RillType = fields !== undefined
      ? { type: 'dict', fields }
      : { type: 'dict' };
    return {
      name,
      type,
      defaultValue: def,
      annotations: buildAnnotations(desc),
    };
  },

  /**
   * IR-5: Creates a list parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param itemType - Optional element type; omitted when not provided
   * @param desc - Optional description
   * @returns RillParam with type 'list' (with element if itemType provided)
   */
  list(name: string, itemType?: RillType, desc?: string): RillParam {
    validateParamName(name);
    const type: RillType = itemType !== undefined
      ? { type: 'list', element: itemType }
      : { type: 'list' };
    return {
      name,
      type,
      defaultValue: undefined,
      annotations: buildAnnotations(desc),
    };
  },

  /**
   * IR-6: Creates a callable parameter descriptor.
   *
   * @param name - Parameter name (must be a valid identifier)
   * @param desc - Optional description
   * @returns RillParam with type 'closure'
   */
  callable(name: string, desc?: string): RillParam {
    validateParamName(name);
    return {
      name,
      type: { type: 'closure' },
      defaultValue: undefined,
      annotations: buildAnnotations(desc),
    };
  },
};
