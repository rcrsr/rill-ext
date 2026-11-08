/**
 * Pure helpers for the Anthropic extension: return-type structures,
 * wire-format translators, error detection, and validation halts.
 */

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import {
  RuntimeError,
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
  type TypeStructure,
} from '@rcrsr/rill';
import {
  MESSAGES_LIST_STRUCTURE,
  type Message,
  type Part,
  type ProviderErrorDetector,
} from '@rcrsr/rill-ext-llm-shared';

// ============================================================
// MODULE-LEVEL RETURN TYPE STRUCTURES
// ============================================================

/**
 * TypeStructure for the `message` host function resolved dict.
 * Hoisted to module-level to avoid drift between createRillStream.retType
 * and the RillFunction.returnType slot (§EXT.6 anti-pattern).
 */
export const MESSAGE_RET_TYPE_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    model: { type: { kind: 'string' } },
    usage: {
      type: {
        kind: 'dict',
        fields: {
          input: { type: { kind: 'number' } },
          output: { type: { kind: 'number' } },
        },
      },
    },
    stop_reason: { type: { kind: 'string' } },
    id: { type: { kind: 'string' } },
    messages: { type: MESSAGES_LIST_STRUCTURE },
  },
};

/**
 * TypeStructure for the `tool_loop` host function resolved dict.
 * Includes the `turns` counter not present in the plain `message` result.
 */
export const TOOL_LOOP_RET_TYPE_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    model: { type: { kind: 'string' } },
    usage: {
      type: {
        kind: 'dict',
        fields: {
          input: { type: { kind: 'number' } },
          output: { type: { kind: 'number' } },
        },
      },
    },
    stop_reason: { type: { kind: 'string' } },
    id: { type: { kind: 'string' } },
    turns: { type: { kind: 'number' } },
    messages: { type: MESSAGES_LIST_STRUCTURE },
  },
};

/**
 * TypeStructure for the `generate` host function return dict.
 * The `data` field carries the structured output (shape set by caller schema).
 */
export const GENERATE_RETURN_TYPE_STRUCTURE: TypeStructure = {
  kind: 'dict',
  fields: {
    data: { type: { kind: 'any' } },
    raw: { type: { kind: 'string' } },
    messages: { type: MESSAGES_LIST_STRUCTURE },
    model: { type: { kind: 'string' } },
    usage: {
      type: {
        kind: 'dict',
        fields: {
          input: { type: { kind: 'number' } },
          output: { type: { kind: 'number' } },
        },
      },
    },
    stop_reason: { type: { kind: 'string' } },
    id: { type: { kind: 'string' } },
  },
};

// ============================================================
// WIRE TRANSLATION — canonical → Anthropic SDK types
// ============================================================

/**
 * Translate a canonical ImageSource to Anthropic image source param.
 */
function toAnthropicImageSource(
  source: Record<string, RillValue>
): Anthropic.Base64ImageSource | Anthropic.URLImageSource {
  const kind = source['kind'] as string;
  const data = source['data'] as string;
  const mediaType =
    (source['media_type'] as string | undefined) ?? 'image/jpeg';

  if (kind === 'url') {
    return { type: 'url', url: data };
  }
  // Default: base64
  return {
    type: 'base64',
    media_type: mediaType as Anthropic.Base64ImageSource['media_type'],
    data,
  };
}

/**
 * Convert a canonical Part to Anthropic content block params for a user message.
 * Only text, image, and tool_result parts are valid in user messages.
 */
function partToAnthropicUserContent(
  part: Record<string, RillValue>
): Anthropic.ContentBlockParam | null {
  const type = part['type'] as string;

  if (type === 'text') {
    return { type: 'text', text: part['text'] as string };
  }

  if (type === 'image') {
    const source = part['source'] as Record<string, RillValue>;
    return {
      type: 'image',
      source: toAnthropicImageSource(source),
    };
  }

  // tool_result parts are handled separately via buildToolResultMessage
  return null;
}

/**
 * Convert a canonical Part to Anthropic content block param for an assistant message.
 * Only text and tool_use parts are valid in assistant messages.
 */
function partToAnthropicAssistantContent(
  part: Record<string, RillValue>
): Anthropic.ContentBlockParam | null {
  const type = part['type'] as string;

  if (type === 'text') {
    return { type: 'text', text: part['text'] as string };
  }

  if (type === 'tool_use') {
    return {
      type: 'tool_use',
      id: part['id'] as string,
      name: part['name'] as string,
      input: part['input'] ?? {},
    };
  }

  return null;
}

/**
 * Convert canonical tool_result parts from a user message into Anthropic
 * ToolResultBlockParams for a user turn.
 */
function extractToolResultBlocks(
  parts: Array<Record<string, RillValue>>
): Anthropic.ToolResultBlockParam[] {
  const blocks: Anthropic.ToolResultBlockParam[] = [];
  for (const part of parts) {
    if (part['type'] === 'tool_result') {
      const resultParts = (part['parts'] ?? []) as Array<
        Record<string, RillValue>
      >;
      const content: string = resultParts
        .filter((rp) => rp['type'] === 'text')
        .map((rp) => rp['text'] as string)
        .join('');

      blocks.push({
        type: 'tool_result',
        tool_use_id: part['id'] as string,
        content,
      });
    }
  }
  return blocks;
}

/**
 * Translate a canonical Message[] into Anthropic MessageParam[].
 *
 * System role messages are lifted into the returned `systemText` string.
 * A list with a system turn overrides the factory system parameter.
 *
 * Tool_result parts in user messages are placed as ToolResultBlockParam arrays
 * per the Anthropic wire format.
 */
export function canonicalToAnthropicMessages(messages: Message[]): {
  apiMessages: Anthropic.MessageParam[];
  systemText: string | undefined;
} {
  let systemText: string | undefined;
  const apiMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Lift system turn into top-level system parameter
      const textParts = msg.parts.filter((part) => part.type === 'text');
      systemText = textParts.map((part) => part.text).join('\n');
      continue;
    }

    if (msg.role === 'user') {
      const partsAsRecords = msg.parts as unknown as Array<
        Record<string, RillValue>
      >;
      const hasToolResults = partsAsRecords.some(
        (part) => part['type'] === 'tool_result'
      );

      if (hasToolResults) {
        // Place tool_result blocks inside user role (Anthropic wire format)
        const toolResultBlocks = extractToolResultBlocks(partsAsRecords);
        const textBlocks: Anthropic.ContentBlockParam[] = partsAsRecords
          .filter((part) => part['type'] === 'text')
          .map((part) => ({
            type: 'text' as const,
            text: part['text'] as string,
          }));

        const content: Anthropic.ContentBlockParam[] = [
          ...textBlocks,
          ...toolResultBlocks,
        ];

        apiMessages.push({ role: 'user', content });
      } else {
        // Normal user message
        const content: Anthropic.ContentBlockParam[] = partsAsRecords
          .map((part) => partToAnthropicUserContent(part))
          .filter((b): b is Anthropic.ContentBlockParam => b !== null);

        if (content.length === 1 && content[0]?.type === 'text') {
          // Optimize: use string shorthand for simple text
          apiMessages.push({
            role: 'user',
            content: content[0].text,
          });
        } else {
          apiMessages.push({ role: 'user', content });
        }
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const partsAsRecords = msg.parts as unknown as Array<
        Record<string, RillValue>
      >;
      const content: Anthropic.ContentBlockParam[] = partsAsRecords
        .map((part) => partToAnthropicAssistantContent(part))
        .filter((b): b is Anthropic.ContentBlockParam => b !== null);

      if (content.length === 1 && content[0]?.type === 'text') {
        apiMessages.push({
          role: 'assistant',
          content: content[0].text,
        });
      } else {
        apiMessages.push({ role: 'assistant', content });
      }
    }
  }

  return { apiMessages, systemText };
}

/**
 * Convert Anthropic response content blocks to canonical Part[].
 * Handles text, tool_use, thinking, and redacted_thinking blocks.
 * RedactedThinkingBlock → {type:'thinking', text:''}.
 */
export function anthropicContentToParts(
  content: Anthropic.ContentBlock[]
): Part[] {
  const parts: Part[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
      continue;
    }

    if (block.type === 'tool_use') {
      parts.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input as Record<string, RillValue>,
      });
      continue;
    }

    if (block.type === 'thinking') {
      const thinkingBlock = block;
      parts.push({
        type: 'thinking',
        text: thinkingBlock.thinking ?? '',
      });
      continue;
    }

    // RedactedThinkingBlock: pass through as thinking with empty text
    if (block.type === 'redacted_thinking') {
      parts.push({ type: 'thinking', text: '' });
      continue;
    }
  }

  return parts;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extract text content from Anthropic API response content array.
 *
 * @param content - Content array from API response
 * @returns Concatenated text from all text blocks
 */
export function extractTextContent(
  content: Array<{ type: string; text?: string }>
): string {
  return content
    .filter(
      (block) =>
        block.type === 'text' && block.text !== undefined && block.text !== ''
    )
    .map((block) => block.text)
    .join('');
}

/**
 * Anthropic-specific error detector for mapProviderError.
 * Extracts status code and message from APIError instances.
 *
 * @param error - Unknown error value
 * @returns Object with status and message if Anthropic error, null otherwise
 */
export const detectAnthropicError: ProviderErrorDetector = (error: unknown) => {
  if (error instanceof APIError) {
    const status: unknown = error.status;
    return {
      ...(typeof status === 'number' ? { status } : {}),
      message: error.message,
    };
  }
  return null;
};

/**
 * Run shared validators inside a host fn closure, converting any
 * RILL-R001 they throw into an invalid RillValue via `ctx.invalidate`.
 * Halts evaluation via RuntimeHaltSignal so host scripts can `guard #INVALID_INPUT`.
 */
export function runInFnValidation(
  ctx: RuntimeContext,
  run: () => void,
  rawKind: string
): void {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof RuntimeError && error.errorId === 'RILL-R001') {
      throw new RuntimeHaltSignal(
        ctx.invalidate(error, {
          code: 'INVALID_INPUT',
          provider: 'anthropic',
          raw: { kind: rawKind, message: error.message },
        }),
        true
      );
    }
    throw error;
  }
}

/**
 * Build an invalid-RillValue halt signal carrying a generic atom.
 * Host scripts recover via `guard #<ATOM>`.
 */
export function haltInvalid(
  ctx: RuntimeContext,
  code: string,
  rawKind: string,
  message: string
): RuntimeHaltSignal {
  return new RuntimeHaltSignal(
    ctx.invalidate(new Error(message), {
      code,
      provider: 'anthropic',
      raw: { kind: rawKind, message },
    }),
    true
  );
}
