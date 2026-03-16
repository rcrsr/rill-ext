/**
 * Introspection function generation for MCP Server Mapper Extension.
 *
 * Generates tools, resources, and prompts as zero-arg RillFunctions that
 * return pre-built dicts of callable closures. The dicts contain callables
 * for the filtered (available) functions only.
 */

import type { RillFunction, RillValue } from '@rcrsr/rill';
import { structureToTypeValue, toCallable } from '@rcrsr/rill';

// ============================================================
// INTROSPECTION FUNCTION GENERATION
// ============================================================

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
function buildCallableDict(functions: Record<string, RillFunction>): Record<string, RillValue> {
  const dict: Record<string, RillValue> = {};
  for (const [name, rillFn] of Object.entries(functions)) {
    // Ensure description annotation is set for introspection
    const withDescription: RillFunction = {
      ...rillFn,
      annotations: { description: rillFn.annotations?.['description'] ?? '' },
    };
    dict[name] = toCallable(withDescription) as unknown as RillValue;
  }
  return dict;
}

/**
 * Creates introspection functions for MCP capabilities.
 *
 * Returns three zero-arg RillFunctions that return pre-built callable dicts:
 * - tools(): dict of tool name → callable closure (with description and params)
 * - resources(): dict of resource name → callable closure
 * - prompts(): dict of prompt name → callable closure
 *
 * The dicts are built at factory time and returned by reference on each call.
 *
 * @param toolFunctions - Tool functions keyed by sanitized function name
 * @param resourceFunctions - Resource functions keyed by sanitized function name
 * @param promptFunctions - Prompt functions keyed by sanitized function name
 * @returns Record of function name to RillFunction
 */
export function createIntrospectionFunctions(
  toolFunctions: Record<string, RillFunction>,
  resourceFunctions: Record<string, RillFunction>,
  promptFunctions: Record<string, RillFunction>
): Record<string, RillFunction> {
  // Build callable dicts at creation time (static references)
  const toolsDict = buildCallableDict(toolFunctions);
  const resourcesDict = buildCallableDict(resourceFunctions);
  const promptsDict = buildCallableDict(promptFunctions);

  return {
    tools: {
      params: [],
      fn: async (): Promise<RillValue> => toolsDict,
      annotations: { description: 'Available MCP tools as callable closures' },
      returnType: structureToTypeValue({ kind: 'dict' }),
    },
    resources: {
      params: [],
      fn: async (): Promise<RillValue> => resourcesDict,
      annotations: { description: 'Available MCP resources as callable closures' },
      returnType: structureToTypeValue({ kind: 'dict' }),
    },
    prompts: {
      params: [],
      fn: async (): Promise<RillValue> => promptsDict,
      annotations: { description: 'Available MCP prompts as callable closures' },
      returnType: structureToTypeValue({ kind: 'dict' }),
    },
  };
}
