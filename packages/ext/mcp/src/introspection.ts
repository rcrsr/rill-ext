/**
 * Introspection dict generation for MCP Server Mapper Extension.
 *
 * Builds tools, resources, and prompts as pre-built dicts of callable closures.
 * The dicts contain callables for the filtered (available) functions only.
 */

import type { RillFunction, RillValue } from '@rcrsr/rill';
import { toCallable } from '@rcrsr/rill';

// ============================================================
// INTROSPECTION DICT GENERATION
// ============================================================

/**
 * Return type for createIntrospectionDicts — one dict per capability category.
 */
export interface IntrospectionDicts {
  readonly tools: Record<string, RillValue>;
  readonly resources: Record<string, RillValue>;
  readonly prompts: Record<string, RillValue>;
}

/**
 * Build a dict of typed callable closures from a record of RillFunctions.
 *
 * Uses toCallable() from rill core to convert each RillFunction to an
 * ApplicationCallable with full type metadata (params, returnType, annotations).
 * Overrides annotations to include description for introspection.
 *
 * @param functions - RillFunctions keyed by sanitized name
 * @returns Record mapping name to callable RillValue
 */
function buildCallableDict(
  functions: Record<string, RillFunction>
): Record<string, RillValue> {
  const dict: Record<string, RillValue> = {};
  for (const [name, rillFn] of Object.entries(functions)) {
    // Ensure description annotation is set for introspection
    const withDescription: RillFunction = {
      ...rillFn,
      annotations: {
        ...rillFn.annotations,
        description: rillFn.annotations?.['description'] ?? '',
      },
    };
    dict[name] = toCallable(withDescription) as unknown as RillValue;
  }
  return dict;
}

/**
 * Creates introspection dicts for MCP capabilities.
 *
 * Returns three pre-built callable dicts:
 * - tools: dict of tool name → callable closure (with description and params)
 * - resources: dict of resource name → callable closure
 * - prompts: dict of prompt name → callable closure
 *
 * The dicts are built at factory time and assigned directly to the extension value.
 *
 * @param toolFunctions - Tool functions keyed by sanitized function name
 * @param resourceFunctions - Resource functions keyed by sanitized function name
 * @param promptFunctions - Prompt functions keyed by sanitized function name
 * @returns IntrospectionDicts with one callable dict per capability category
 */
export function createIntrospectionDicts(
  toolFunctions: Record<string, RillFunction>,
  resourceFunctions: Record<string, RillFunction>,
  promptFunctions: Record<string, RillFunction>
): IntrospectionDicts {
  return {
    tools: buildCallableDict(toolFunctions),
    resources: buildCallableDict(resourceFunctions),
    prompts: buildCallableDict(promptFunctions),
  };
}
