/**
 * Prompt function generation for MCP Server Mapper Extension.
 *
 * Converts MCP prompts to rill RillFunction objects:
 * - Each prompt becomes ns::prompts.{prompt_name}(params...) -> list
 * - Returns list of dicts with role and content fields
 * - Multi-part content concatenated to single string per message
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RillFunction, RillValue, RuntimeContext } from '@rcrsr/rill';
import {
  emitExtensionEvent,
  getStatus,
  isInvalid,
  structureToTypeValue,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import {
  failInput,
  failTimeout,
  mapMcpError,
} from './errors.js';
import { sanitizeNames } from './naming.js';

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
 * MCP prompt from server.
 */
export interface McpPrompt {
  readonly name: string;
  readonly description?: string | undefined;
  readonly arguments?: McpPromptArgument[] | undefined;
}

/**
 * MCP prompt argument definition.
 */
export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string | undefined;
  readonly required?: boolean | undefined;
}

/**
 * MCP prompt message content (text or image).
 */
export interface McpPromptMessageContent {
  readonly type: 'text' | 'image' | string;
  readonly text?: string | undefined;
  readonly data?: string | undefined; // base64 for images
  readonly mimeType?: string | undefined;
}

/**
 * MCP prompt message.
 */
export interface McpPromptMessage {
  readonly role: 'user' | 'assistant' | string;
  readonly content: McpPromptMessageContent | McpPromptMessageContent[];
}

/**
 * MCP prompt get result.
 */
export interface McpPromptResult {
  readonly messages: McpPromptMessage[];
}

// ============================================================
// MESSAGE PARSING
// ============================================================

/**
 * Concatenates multi-part message content to single string.
 *
 * Handles both single content objects and arrays of content.
 * For text content: extracts the text field.
 * For image content: returns placeholder (images not supported in rill strings).
 * Multiple content parts are joined with newlines.
 *
 * @param content - Single content object or array of content objects
 * @returns Concatenated string content
 */
function concatenateMessageContent(
  content: McpPromptMessageContent | McpPromptMessageContent[]
): string {
  // Handle single content object
  if (!Array.isArray(content)) {
    if (content.type === 'text' && content.text !== undefined) {
      return content.text;
    }
    // For non-text content (e.g., images), return empty string
    return '';
  }

  // Handle array of content objects
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text !== undefined) {
      parts.push(part.text);
    }
    // Skip non-text content
  }

  return parts.join('\n');
}

/**
 * Converts MCP prompt result to rill list of dicts.
 *
 * Transforms MCP message format to rill data structure:
 * - Each message becomes a dict with 'role' and 'content' keys
 * - Multi-part content is concatenated to single string
 * - Returns list of dicts: [[role: "user", content: "..."], ...]
 *
 * @param result - MCP prompt result
 * @returns List of message dicts
 */
function parsePromptMessages(result: McpPromptResult): RillValue {
  const messages: RillValue[] = [];

  for (const message of result.messages) {
    const contentString = concatenateMessageContent(message.content);

    const messageDict: { [key: string]: RillValue } = {
      role: message.role,
      content: contentString,
    };

    messages.push(messageDict);
  }

  return messages;
}

// ============================================================
// PROMPT FUNCTIONS
// ============================================================

/**
 * Creates a prompt function.
 *
 * Generates rill RillFunction for parameterized prompts.
 * Calls MCP client.getPrompt with prompt name and argument dict.
 * Returns list of dicts with role and content fields.
 *
 * @param prompt - MCP prompt definition
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns RillFunction for this prompt
 */
function createPromptFunction(
  prompt: McpPrompt,
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean }
): RillFunction {
  // Generate parameters from prompt arguments
  const promptArgs = prompt.arguments ?? [];
  const params = promptArgs.map((arg) =>
    p.str(arg.name, arg.description ?? `Prompt argument: ${arg.name}`)
  );

  const fn = async (
    args: Record<string, RillValue>,
    ctxLike: unknown,
  ): Promise<RillValue> => {
    const ctx = ctxLike as RuntimeContext;

    if (!lifecycleState.connectEmitted) {
      emitExtensionEvent(ctx, {
        event: 'mcp:connect',
        subsystem: 'extension:mcp',
      });
      lifecycleState.connectEmitted = true;
    }

    const argsDict: Record<string, string> = {};
    for (let i = 0; i < promptArgs.length; i++) {
      const promptArg = promptArgs[i]!;
      const value = args[promptArg.name];

      if (value !== undefined && typeof value !== 'string') {
        throw failInput(
          ctx,
          `expected string for parameter ${promptArg.name}, got ${typeof value}`,
          { name: prompt.name, parameter: promptArg.name },
        );
      }

      if (value !== undefined) {
        argsDict[promptArg.name] = value;
      } else if (promptArg.required === true) {
        throw failInput(
          ctx,
          `required parameter ${promptArg.name} is missing`,
          { name: prompt.name, parameter: promptArg.name, kind: 'missing_required' },
        );
      }
    }

    emitExtensionEvent(ctx, {
      event: 'mcp:prompt_get',
      subsystem: 'extension:mcp',
      prompt: prompt.name,
      params: argsDict,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(failTimeout(ctx, prompt.name, timeoutMs));
      }, timeoutMs);
      timer.unref();
    });

    try {
      const result = (await Promise.race([
        client.getPrompt({
          name: prompt.name,
          arguments: argsDict,
        }),
        timeoutPromise,
      ])) as McpPromptResult;

      return parsePromptMessages(result);
    } catch (error) {
      emitExtensionEvent(ctx, {
        event: 'mcp:error',
        subsystem: 'extension:mcp',
        error: describeError(error),
        prompt: prompt.name,
      });
      throw mapMcpError(ctx, error, prompt.name);
    }
  };

  return {
    params,
    fn,
    ...(prompt.description !== undefined && {
      annotations: { description: prompt.description },
    }),
    returnType: structureToTypeValue({ kind: 'list', element: { kind: 'dict', fields: { role: { type: { kind: 'string' } }, content: { type: { kind: 'string' } } } } }),
  };
}

/**
 * Generates rill host functions for MCP prompts.
 *
 * Applies name sanitization with collision detection and creates
 * RillFunction for each prompt.
 *
 * Prompt names are sanitized without prefix — namespacing is handled by the value dict.
 *
 * @param prompts - Array of MCP prompts
 * @param client - Connected MCP client
 * @param timeoutMs - Timeout in milliseconds
 * @param lifecycleState - Shared state for lifecycle event tracking
 * @returns Record of sanitized function name to RillFunction
 */
export function generatePromptFunctions(
  prompts: McpPrompt[],
  client: Client,
  timeoutMs: number,
  lifecycleState: { connectEmitted: boolean } = { connectEmitted: false }
): Record<string, RillFunction> {
  // Sanitize names with collision detection
  const rawNames = prompts.map((prompt) => prompt.name);
  const nameMap = sanitizeNames(rawNames);
  const functions: Record<string, RillFunction> = {};

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]!;
    const rawName = rawNames[i]!;
    const sanitizedName = nameMap.get(rawName);

    if (!sanitizedName) {
      // Should never happen: sanitizeNames processes all names
      continue;
    }

    functions[sanitizedName] = createPromptFunction(
      prompt,
      client,
      timeoutMs,
      lifecycleState
    );
  }

  return functions;
}
