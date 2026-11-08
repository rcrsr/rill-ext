/**
 * Pure helpers for the OpenAI extension: wire-format translators, error
 * detection, shared return types and argument validators.
 */

import OpenAI, { APIError } from 'openai';
import type {
  Response as OAIResponse,
  ResponseInputItem,
} from 'openai/resources/responses/responses.js';
import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
  type TypeStructure,
} from '@rcrsr/rill';
import {
  RESERVED_KEYS_COMMON,
  PARTS_LIST_STRUCTURE,
  type ProviderErrorDetector,
  type Message,
  type Part,
} from '@rcrsr/rill-ext-llm-shared';

// CONSTANTS
// ============================================================

export const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

/**
 * Reserved keys for OpenAI — union of COMMON + Chat Completions + Responses API.
 * Using the superset so `extra` config remains portable across model upgrades.
 */
export const RESERVED_KEYS_OPENAI: readonly string[] = [
  ...RESERVED_KEYS_COMMON,
  'tools',
  'tool_choice',
  'function_call',
  'functions',
  'input',
  'instructions',
  'previous_response_id',
  'reasoning',
];

/**
 * Regex that matches o-series reasoning model IDs.
 * Matches: o1, o1-mini, o3, o3-mini, o4-mini, o1-preview, etc.
 * Does NOT match: gpt-4o, gpt-4o-mini (these start with 'gpt').
 */
export const O_SERIES_PATTERN = /^o\d/;

// ============================================================
// ERROR DETECTION
// ============================================================

/**
 * OpenAI-specific error detector for mapProviderError.
 * Extracts status code and message from APIError instances.
 */
export const detectOpenAIError: ProviderErrorDetector = (error: unknown) => {
  // A user-initiated abort is a cancellation, not an API failure.
  if (
    error instanceof Error &&
    error.constructor.name === 'APIUserAbortError'
  ) {
    return null;
  }
  if (error instanceof APIError) {
    return {
      ...(typeof error.status === 'number' ? { status: error.status } : {}),
      message: error.message,
    };
  }
  return null;
};

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
      provider: 'openai',
      raw: { kind: rawKind, message },
    }),
    true
  );
}

// ============================================================
// CANONICAL ↔ WIRE TRANSLATORS: Chat Completions
// ============================================================

/**
 * Convert canonical Message[] (parts-shaped) to OpenAI Chat Completions wire format.
 * system messages → { role: 'system', content: string }
 * user messages → { role: 'user', content: string } (tool_result parts become role:'tool' messages)
 * assistant messages → { role: 'assistant', content, tool_calls? }
 */
export function canonicalToCC(
  messages: Message[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.parts
        .filter((pt) => pt.type === 'text')
        .map((pt) => pt.text)
        .join('');
      result.push({ role: 'system', content: text });
      continue;
    }

    if (msg.role === 'user') {
      // tool_result parts → role:'tool' messages (before user content)
      const toolResultParts = msg.parts.filter(
        (pt) => pt.type === 'tool_result'
      );
      for (const part of toolResultParts) {
        const tr = part as { type: 'tool_result'; id: string; parts: Part[] };
        const resultContent = tr.parts
          .filter((pt) => pt.type === 'text')
          .map((pt) => pt.text)
          .join('');
        result.push({
          role: 'tool',
          tool_call_id: tr.id,
          content: resultContent,
        });
      }

      const contentParts = msg.parts.filter((pt) => pt.type !== 'tool_result');
      if (contentParts.length > 0) {
        const textContent = contentParts
          .filter((pt) => pt.type === 'text')
          .map((pt) => pt.text)
          .join('');
        result.push({ role: 'user', content: textContent });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textParts = msg.parts.filter((pt) => pt.type === 'text');
      const toolUseParts = msg.parts.filter((pt) => pt.type === 'tool_use');

      const content = textParts.map((pt) => pt.text).join('') || null;

      if (toolUseParts.length > 0) {
        const toolCalls = toolUseParts.map((pt) => {
          const tu = pt;
          return {
            id: tu.id,
            type: 'function' as const,
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          };
        });
        result.push({ role: 'assistant', content, tool_calls: toolCalls });
      } else {
        result.push({ role: 'assistant', content: content ?? '' });
      }
    }
  }

  return result;
}

/**
 * Convert OpenAI Chat Completions response choice to canonical assistant Message.
 */
export function ccChoiceToCanonical(
  choice: OpenAI.Chat.Completions.ChatCompletion['choices'][0]
): Message {
  const parts: Part[] = [];
  const msg = choice.message;

  if (msg.content !== null && msg.content !== '') {
    parts.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      // tool_calls items have a .function property on ChatCompletionMessageToolCall
      const fn = (
        tc as {
          type: string;
          id: string;
          function: { name: string; arguments: string };
        }
      ).function;
      const toolInput = (() => {
        try {
          return JSON.parse(fn.arguments) as Record<string, RillValue>;
        } catch {
          return {} as Record<string, RillValue>;
        }
      })();
      parts.push({
        type: 'tool_use',
        id: tc.id,
        name: fn.name,
        input: toolInput,
      });
    }
  }

  return { role: 'assistant', parts };
}

// ============================================================
// CANONICAL ↔ WIRE TRANSLATORS: Responses API
// ============================================================

/**
 * Convert canonical Message[] to Responses API input items and instructions.
 */
export function canonicalToResponsesAPI(messages: Message[]): {
  input: ResponseInputItem[];
  instructions: string | undefined;
} {
  let instructions: string | undefined;
  const input: ResponseInputItem[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.parts
        .filter((pt) => pt.type === 'text')
        .map((pt) => pt.text)
        .join('');
      instructions = text || undefined;
      continue;
    }

    if (msg.role === 'user') {
      // tool_result parts → function_call_output items (use call_id = part.id)
      const toolResultParts = msg.parts.filter(
        (pt) => pt.type === 'tool_result'
      );
      for (const part of toolResultParts) {
        const tr = part as { type: 'tool_result'; id: string; parts: Part[] };
        const resultContent = tr.parts
          .filter((pt) => pt.type === 'text')
          .map((pt) => pt.text)
          .join('');
        input.push({
          type: 'function_call_output',
          call_id: tr.id,
          output: resultContent,
        });
      }

      const contentParts = msg.parts.filter((pt) => pt.type === 'text');
      if (contentParts.length > 0) {
        const text = contentParts.map((pt) => pt.text).join('');
        input.push({
          role: 'user',
          content: text,
        });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      // thinking parts → reasoning items (summary_text format)
      const thinkingParts = msg.parts.filter((pt) => pt.type === 'thinking');
      for (const part of thinkingParts) {
        const th = part;
        // Responses API ReasoningItem needs an id; use a synthetic one
        input.push({
          type: 'reasoning',
          id: `reasoning_${Date.now()}`,
          summary: [{ type: 'summary_text', text: th.text }],
        } as unknown as ResponseInputItem);
      }

      // tool_use parts → function_call items using call_id
      const toolUseParts = msg.parts.filter((pt) => pt.type === 'tool_use');
      for (const part of toolUseParts) {
        const tu = part;
        input.push({
          type: 'function_call',
          call_id: tu.id,
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        } as unknown as ResponseInputItem);
      }

      // text parts → assistant message
      const textParts = msg.parts.filter((pt) => pt.type === 'text');
      if (textParts.length > 0) {
        const text = textParts.map((pt) => pt.text).join('');
        input.push({
          role: 'assistant',
          content: text,
        });
      }
    }
  }

  return { input, instructions };
}

/**
 * Convert a Responses API response to canonical assistant Message.
 * Handles text output items, function_call items, and reasoning items.
 */
export function responsesAPIToCanonical(response: OAIResponse): Message {
  const parts: Part[] = [];

  for (const item of response.output) {
    if (item.type === 'message') {
      const outputMsg = item;
      for (const contentItem of outputMsg.content) {
        if (contentItem.type === 'output_text') {
          parts.push({ type: 'text', text: contentItem.text });
        }
      }
    } else if (item.type === 'function_call') {
      const fc = item;
      const fcInput = (() => {
        try {
          return JSON.parse(fc.arguments) as Record<string, RillValue>;
        } catch {
          return {} as Record<string, RillValue>;
        }
      })();
      // Responses API uses call_id for tool threading (not id)
      parts.push({
        type: 'tool_use',
        id: fc.call_id,
        name: fc.name,
        input: fcInput,
      });
    } else if (item.type === 'reasoning') {
      const ri = item;
      const summaryText = ri.summary
        .filter((s) => s.type === 'summary_text')
        .map((s) => s.text)
        .join('');
      if (summaryText) {
        parts.push({ type: 'thinking', text: summaryText });
      }
    }
  }

  return { role: 'assistant', parts };
}

// ============================================================
// SHARED RETURN TYPE STRUCTURE
// ============================================================

export const VERB_STREAM_RET_TYPE: TypeStructure = {
  kind: 'dict',
  fields: {
    messages: {
      type: {
        kind: 'list',
        element: {
          kind: 'dict',
          fields: {
            role: { type: { kind: 'string' } },
            parts: { type: PARTS_LIST_STRUCTURE },
          },
        },
      },
    },
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
// SHARED: validate tool_loop boundary args
// ============================================================

export function validateToolLoopArgs(
  toolsDict: RillValue,
  perCallMaxTurns: number,
  ctx: RuntimeContext
): void {
  // Negative per-call max_turns
  if (perCallMaxTurns < 0) {
    throw haltInvalid(
      ctx,
      'INVALID_INPUT',
      'invalid_max_turns',
      'max_turns must be >= 0'
    );
  }

  // Empty tools dict
  if (
    typeof toolsDict === 'object' &&
    toolsDict !== null &&
    !Array.isArray(toolsDict) &&
    Object.keys(toolsDict).length === 0
  ) {
    throw haltInvalid(
      ctx,
      'INVALID_INPUT',
      'empty_tools_dict',
      'tools dict cannot be empty'
    );
  }
}

export function extractJson(content: string, reasoning: string): string {
  const candidate = content.trim() !== '' ? content : reasoning;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    /* fall through */
  }
  const m = candidate.match(/\{[\s\S]*\}/);
  return m ? m[0] : candidate;
}
