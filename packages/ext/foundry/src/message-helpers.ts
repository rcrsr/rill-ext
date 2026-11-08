/**
 * Pure helpers for the Foundry extension: message conversion, last-message
 * text extraction and the halt-signal builder.
 */

import { RuntimeHaltSignal, type RuntimeContext } from '@rcrsr/rill';
import type { Message } from '@rcrsr/rill-ext-llm-shared';
import type OpenAI from 'openai';

/**
 * Extract a text string from the last message in a messages array.
 * Used by the tool_loop per-iteration auto-shield to obtain the text
 * to evaluate regardless of whether the iteration carries a user prompt
 * or tool results.
 */
export function extractLastMessageText(msgs: unknown[]): string {
  if (msgs.length === 0) {
    return '';
  }
  const last = msgs.at(-1);
  if (typeof last !== 'object' || last === null) {
    return '';
  }
  const msg = last as Record<string, unknown>;
  const content = msg['content'];
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Some message formats use content as an array of part objects
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (
          typeof part === 'object' &&
          part !== null &&
          typeof (part as Record<string, unknown>)['text'] === 'string'
        ) {
          return (part as Record<string, unknown>)['text'] as string;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Convert canonical Message[] (parts-shaped) to OpenAI Chat Completions wire format.
 * Only text parts are extracted; non-text parts are silently dropped for simple
 * message/generate paths (tool_loop uses its own wire format via callbacks).
 */
export function messagesToOpenAI(
  messages: Message[]
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    const content = msg.parts
      .filter(
        (part): part is { type: 'text'; text: string } => part.type === 'text'
      )
      .map((part) => part.text)
      .join('');
    return { role: msg.role, content };
  });
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
      provider: 'foundry',
      raw: { kind: rawKind, message },
    }),
    true
  );
}
