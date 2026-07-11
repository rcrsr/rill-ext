/**
 * Resource function generation for MCP Server Mapper Extension.
 *
 * Converts MCP resources to rill RillFunction objects:
 * - Static resource read: ns::read_resource(uri: string) -> dict
 * - Resource templates: ns::resource_{template_name}(params...) -> dict
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RillFunction, RillValue, RuntimeContext } from '@rcrsr/rill';
import {
  anyTypeValue,
  emitExtensionEvent,
  getStatus,
  isInvalid,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import { failInput, failTimeout, mapMcpError } from './errors.js';
import { sanitizeNames } from './naming.js';
import { parseResourceContent } from './parsing.js';

function describeError(error: unknown): string {
  if (isInvalid(error as RillValue)) {
    return getStatus(error as RillValue).message;
  }
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// MCP TYPES (subset from SDK)
// ============================================================

/**
 * MCP resource template from server.
 */
export interface McpResourceTemplate {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * MCP static resource from server.
 */
export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result content block.
 */
interface McpResourceContent {
  readonly uri: string;
  readonly text?: string | undefined;
  readonly blob?: string | undefined; // base64
  readonly mimeType?: string | undefined;
}

/**
 * MCP resource read result.
 */
export interface McpResourceResult {
  readonly contents: McpResourceContent[];
}

// ============================================================
// URI TEMPLATE PARSING
// ============================================================

/**
 * Extracts RFC 6570 template variables from a URI template.
 *
 * Extracts variable names from {varName} patterns in URI template strings.
 * Only simple variable expansion is supported (no operators like {+var}, {#var}, etc.).
 *
 * Examples:
 * - "db://table/{tableName}/row/{rowId}" -> ["tableName", "rowId"]
 * - "file:///{path}" -> ["path"]
 * - "static://resource" -> []
 *
 * @param uriTemplate - RFC 6570 URI template string
 * @returns Array of variable names (in order of appearance)
 */
export function extractTemplateVariables(uriTemplate: string): string[] {
  const variables: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(uriTemplate)) !== null) {
    const varName = match[1]!.trim();
    // Only capture simple variable names (no operators like +, #, ., /, ;, ?, &)
    if (varName && !/[+#./;?&]/.test(varName)) {
      variables.push(varName);
    }
  }

  return variables;
}

/**
 * Expands a URI template with provided arguments.
 *
 * Substitutes {varName} patterns with corresponding argument values.
 * All argument values are converted to strings for URI expansion.
 *
 * @param uriTemplate - RFC 6570 URI template string
 * @param variables - Variable names in order
 * @param args - Argument values in order
 * @returns Expanded URI string
 */
function expandUriTemplate(
  uriTemplate: string,
  variables: string[],
  args: Record<string, RillValue>
): string {
  let expanded = uriTemplate;

  for (let i = 0; i < variables.length; i++) {
    const varName = variables[i]!;
    const value = args[varName];
    // Convert value to string for URI expansion
    const stringValue = value !== undefined ? String(value) : '';
    expanded = expanded.replace(`{${varName}}`, stringValue);
  }

  return expanded;
}

// ============================================================
// RESOURCE READ FUNCTION
// ============================================================

/**
 * Creates the static read_resource function.
 *
 * Generates rill RillFunction for reading MCP resources by URI.
 * Calls MCP client.readResource with timeout and parses response content.
 *
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns RillFunction for read_resource
 */
export function createReadResourceFunction(
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): RillFunction {
  const fn = async (
    args: Record<string, RillValue>,
    ctxLike: unknown
  ): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;

    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }

    const uri = args['uri'];

    if (typeof uri !== 'string') {
      throw failInput(ctx, `expected string uri, got ${typeof uri}`, {
        name: 'read_resource',
      });
    }

    emitExtensionEvent(ctx, {
      event: 'mcp:resource_read',
      subsystem: 'extension:mcp',
      uri,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(failTimeout(ctx, 'read_resource', timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      const result = (await Promise.race([
        client.readResource({ uri }),
        timeoutPromise,
      ])) as McpResourceResult;

      return parseResourceContent(result);
    } catch (error) {
      emitExtensionEvent(ctx, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: describeError(error),
        uri,
      });
      throw mapMcpError(ctx, error, 'read_resource');
    }
  };

  return {
    params: [p.str('uri', 'Resource URI to read')],
    fn,
    annotations: { description: 'Read an MCP resource by URI' },
    // parseResourceContent returns string, dict, or other structured content
    // depending on the resource's content blocks; the schema is set by the
    // MCP server at runtime per §EXT.8.3 case 4 (heterogeneous runtime state).
    returnType: anyTypeValue,
  };
}

// ============================================================
// STATIC RESOURCE FUNCTIONS
// ============================================================

/**
 * Creates a zero-param function for a static MCP resource.
 *
 * Pre-binds the resource URI so callers need no arguments.
 * Emits lifecycle events and reads the resource with timeout.
 *
 * @param resource - MCP static resource
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @param callableName - Sanitized callable name exposed to users (for error messages)
 * @returns RillFunction with zero params
 */
function createStaticResourceFunction(
  resource: McpResource,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean },
  callableName: string
): RillFunction {
  // Build description: use resource.description if provided, otherwise derive from name.
  // Append MIME type when present.
  const baseDescription =
    resource.description !== undefined
      ? resource.description
      : `Read resource: ${resource.name}`;
  const description =
    resource.mimeType !== undefined
      ? `${baseDescription} (MIME: ${resource.mimeType})`
      : baseDescription;

  const uri = resource.uri;

  const fn = async (
    _args: Record<string, RillValue>,
    ctxLike: unknown
  ): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;

    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }

    emitExtensionEvent(ctx, {
      event: 'mcp:resource_read',
      subsystem: 'extension:mcp',
      uri,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(failTimeout(ctx, callableName, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      const result = (await Promise.race([
        client.readResource({ uri }),
        timeoutPromise,
      ])) as McpResourceResult;

      return parseResourceContent(result);
    } catch (error) {
      emitExtensionEvent(ctx, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: describeError(error),
        uri,
      });
      throw mapMcpError(ctx, error, callableName);
    }
  };

  return {
    params: [],
    fn,
    annotations: { description },
    // parseResourceContent returns string, dict, or other structured content
    // depending on the resource's content blocks (§EXT.8.3 case 4).
    returnType: anyTypeValue,
  };
}

/**
 * Generates rill host functions for MCP static resources.
 *
 * Applies name sanitization with collision detection and creates
 * a zero-param RillFunction for each static resource.
 *
 * Resource names are prefixed with "resource_" to distinguish from other functions.
 *
 * @param resources - Array of MCP static resources
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to RillFunction
 */
export function generateStaticResourceFunctions(
  resources: McpResource[],
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, RillFunction> {
  // Prefix resource names with "resource_" before sanitization
  const prefixedNames = resources.map(
    (resource) => `resource_${resource.name}`
  );

  // Sanitize names with collision detection
  const nameMap = sanitizeNames(prefixedNames);
  const functions: Record<string, RillFunction> = {};

  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]!;
    const prefixedName = prefixedNames[i]!;
    const sanitizedName = nameMap.get(prefixedName);

    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = createStaticResourceFunction(
      resource,
      client,
      timeoutMs,
      lifecycleState,
      sanitizedName
    );
  }

  return functions;
}

// ============================================================
// RESOURCE TEMPLATE FUNCTIONS
// ============================================================

/**
 * Creates a resource template function.
 *
 * Generates rill RillFunction for parameterized resource templates.
 * Extracts URI template variables, expands with arguments, and reads resource.
 *
 * @param template - MCP resource template
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns RillFunction for this template
 */
function createResourceTemplateFunction(
  template: McpResourceTemplate,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): RillFunction {
  // Extract template variables
  const variables = extractTemplateVariables(template.uriTemplate);

  // Generate parameters from template variables
  const params = variables.map((varName) =>
    p.str(varName, `URI template variable: ${varName}`)
  );

  const fn = async (
    args: Record<string, RillValue>,
    ctxLike: unknown
  ): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;

    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }

    for (let i = 0; i < variables.length; i++) {
      const varName = variables[i]!;
      const arg = args[varName];
      if (typeof arg !== 'string') {
        throw failInput(
          ctx,
          `expected string for parameter ${varName}, got ${typeof arg}`,
          { name: template.name, parameter: varName }
        );
      }
    }

    const expandedUri = expandUriTemplate(
      template.uriTemplate,
      variables,
      args
    );

    emitExtensionEvent(ctx, {
      event: 'mcp:resource_read',
      subsystem: 'extension:mcp',
      uri: expandedUri,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(failTimeout(ctx, template.name, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      const result = (await Promise.race([
        client.readResource({ uri: expandedUri }),
        timeoutPromise,
      ])) as McpResourceResult;

      return parseResourceContent(result);
    } catch (error) {
      emitExtensionEvent(ctx, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: describeError(error),
        uri: expandedUri,
      });
      throw mapMcpError(ctx, error, template.name);
    }
  };

  return {
    params,
    fn,
    ...(template.description !== undefined && {
      annotations: { description: template.description },
    }),
    // parseResourceContent returns string, dict, or other structured content
    // depending on the expanded URI's content blocks (§EXT.8.3 case 4).
    returnType: anyTypeValue,
  };
}

/**
 * Generates rill host functions for MCP resource templates.
 *
 * Applies name sanitization with collision detection and creates
 * RillFunction for each resource template.
 *
 * Template names are prefixed with "resource_" to distinguish from other functions.
 *
 * @param templates - Array of MCP resource templates
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to RillFunction
 */
export function generateResourceTemplateFunctions(
  templates: McpResourceTemplate[],
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, RillFunction> {
  // Prefix template names with "resource_" before sanitization
  const prefixedNames = templates.map(
    (template) => `resource_${template.name}`
  );

  // Sanitize names with collision detection
  const nameMap = sanitizeNames(prefixedNames);
  const functions: Record<string, RillFunction> = {};

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i]!;
    const prefixedName = prefixedNames[i]!;
    const sanitizedName = nameMap.get(prefixedName);

    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = createResourceTemplateFunction(
      template,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
