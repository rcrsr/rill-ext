/**
 * Tool function generation for MCP Server Mapper Extension.
 *
 * Converts MCP tools to rill RillFunction objects with
 * parameter validation, timeout handling, and result parsing.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RillFunction, RillValue, RuntimeContext } from '@rcrsr/rill';
import {
  anyTypeValue,
  emitExtensionEvent,
  getStatus,
  isInvalid,
  structureToTypeValue,
} from '@rcrsr/rill';
import { failTool, failTimeout, mapMcpError } from './errors.js';

function describeError(error: unknown): string {
  if (isInvalid(error as RillValue)) {
    return getStatus(error as RillValue).message;
  }
  return error instanceof Error ? error.message : String(error);
}
import {
  buildParameterNameMap,
  generateParametersFromSchema,
  jsonSchemaToTypeStructure,
  type JsonSchema,
  type OutputJsonSchema,
} from './parsing.js';
import { sanitizeNames } from './naming.js';

// ============================================================
// MCP TYPES (subset from SDK)
// ============================================================

/**
 * MCP tool definition from server.
 */
export interface McpTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: OutputJsonSchema | undefined;
}

/**
 * MCP tool call result content block.
 */
export interface McpToolContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string | undefined;
  readonly data?: string | undefined; // base64 for images
  readonly mimeType?: string | undefined;
}

/**
 * MCP tool call result.
 */
export interface McpToolResult {
  readonly content: McpToolContent[];
  readonly isError?: boolean | undefined;
}

// ============================================================
// RESULT PARSING
// ============================================================

/**
 * Parses MCP tool result content blocks to rill value.
 *
 * Rules:
 * - Single text block with JSON → parse to dict
 * - Single text block (non-JSON) → return string
 * - Single image block → dict with [type: "image", data: base64, mime: "..."]
 * - Multiple text blocks → concatenate with newlines
 * - Multiple non-text blocks → return structured dict with content array
 *
 * @param result - MCP tool result with content blocks
 * @returns Rill value (string, dict, or structured content)
 */
function parseToolResult(result: McpToolResult): RillValue {
  const { content } = result;

  // Empty content: return empty string
  if (content.length === 0) {
    return '';
  }

  // Single content block: apply type-specific parsing
  if (content.length === 1) {
    const block = content[0]!;

    if (block.type === 'text') {
      const text = block.text ?? '';

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

    if (block.type === 'image') {
      // Image content: return structured dict
      return {
        type: 'image',
        data: block.data ?? '',
        mime: block.mimeType ?? 'image/png',
      };
    }

    // Resource or unknown type: return as text fallback
    return block.text ?? '';
  }

  // Multiple content blocks: check if all are text
  const allText = content.every((block) => block.type === 'text');

  if (allText) {
    // Concatenate text blocks with newlines
    return content.map((block) => block.text ?? '').join('\n');
  }

  // Mixed or multiple non-text blocks: return structured dict
  return {
    content: content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text ?? '' };
      }
      if (block.type === 'image') {
        return {
          type: 'image',
          data: block.data ?? '',
          mime: block.mimeType ?? 'image/png',
        };
      }
      // Resource or unknown
      return { type: block.type, text: block.text ?? '' };
    }),
  };
}

// ============================================================
// TOOL FUNCTION GENERATION
// ============================================================

/**
 * Generates rill RillFunction from MCP tool.
 *
 * Creates async wrapper that:
 * - Emits mcp:tool_call lifecycle event
 * - Calls MCP client.callTool with timeout
 * - Parses result content
 * - Maps errors through the shared error mapper
 * - Emits mcp:error on failures
 *
 * @param tool - MCP tool definition
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns RillFunction for this tool
 */
function generateToolFunction(
  tool: McpTool,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): RillFunction {
  // Generate parameters from JSON Schema
  const params = generateParametersFromSchema(tool.inputSchema);
  // Maps each sanitized param name back to the server's original schema key.
  const originalNames = buildParameterNameMap(tool.inputSchema);

  // Create async function wrapper
  const fn = async (
    args: Record<string, RillValue>,
    ctxLike: unknown
  ): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;
    // Emit mcp:connect on first tool call
    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }
    // Build arguments object from named args record
    const toolArgs: Record<string, unknown> = {};
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      const value = args[param.name];
      // Read by the sanitized name a rill script uses, but send the server the
      // original schema key it declared in inputSchema.
      const wireName = originalNames.get(param.name) ?? param.name;
      toolArgs[wireName] = value !== undefined ? value : param.defaultValue;
    }

    // Emit mcp:tool_call event
    emitExtensionEvent(ctx, {
      event: 'mcp:tool_call',
      subsystem: 'extension:mcp',
      tool: tool.name,
      params: toolArgs,
    });

    // Set up timeout promise: reject with the invalid RillValue directly so
    // the catch block recognises it via isInvalid and passes it through.
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(failTimeout(ctx, tool.name, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      const result = (await Promise.race([
        client.callTool({ name: tool.name, arguments: toolArgs }),
        timeoutPromise,
      ])) as McpToolResult;

      if (result.isError) {
        const errorText = result.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n');
        throw failTool(ctx, tool.name, errorText || 'unknown error');
      }

      return parseToolResult(result);
    } catch (error) {
      emitExtensionEvent(ctx, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: describeError(error),
        tool: tool.name,
      });
      throw mapMcpError(ctx, error, tool.name);
    }
  };

  return {
    params,
    fn,
    ...(tool.description !== undefined && {
      annotations: { description: tool.description },
    }),
    returnType: tool.outputSchema
      ? structureToTypeValue(jsonSchemaToTypeStructure(tool.outputSchema))
      : anyTypeValue,
  };
}

/**
 * Generates rill host functions for all MCP tools.
 *
 * Applies name sanitization with collision detection and creates
 * RillFunction for each tool.
 *
 * @param tools - Array of MCP tool definitions
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to RillFunction
 */
export function generateToolFunctions(
  tools: McpTool[],
  client: Client,
  timeoutMs = 30000,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, RillFunction> {
  // Sanitize tool names with collision detection
  const nameMap = sanitizeNames(tools.map((tool) => tool.name));
  const functions: Record<string, RillFunction> = {};

  for (const tool of tools) {
    const sanitizedName = nameMap.get(tool.name);
    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = generateToolFunction(
      tool,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
