/**
 * Shared helpers for the functions-*.test.ts files.
 */

import {
  type ApplicationCallable,
  type RillTypeValue,
  type TypeStructure,
} from '@rcrsr/rill';
import type { ChatCompletion } from 'openai/resources/chat/completions';

/** Minimal view of the RillStream cursor exercised by these tests. */
export interface StreamCursor {
  __rill_stream?: boolean;
  __rill_stream_resolve?: () => Promise<unknown>;
  done: boolean;
  value?: unknown;
  next: unknown;
}

export function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Build a full ChatCompletion object matching OpenAI response shape.
 */
export function createMockFinalCompletion(
  content: string,
  model = 'gpt-4-turbo'
): ChatCompletion {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion' as const,
    created: 1234567890,
    model,
    choices: [
      {
        index: 0,
        logprobs: null,
        message: { role: 'assistant' as const, content, refusal: null },
        finish_reason: 'stop' as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/**
 * Call the resolve callback on a RillStream returned from fn().
 * Uses the internal __rill_stream_resolve hidden property.
 */
export async function resolveStream(
  stream: unknown
): Promise<Record<string, unknown>> {
  const resolve = (stream as StreamCursor)
    .__rill_stream_resolve as () => Promise<unknown>;
  return (await resolve()) as Record<string, unknown>;
}

/** Build a RillTypeValue from a TypeStructure for test usage. */
export function typeVal(structure: TypeStructure): RillTypeValue {
  return {
    __rill_type: true,
    typeName: structure.kind,
    structure,
  } as unknown as RillTypeValue;
}
