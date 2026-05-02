import type { ApplicationCallable } from '@rcrsr/rill';

/**
 * Compile-time contract for all LLM extensions.
 *
 * Every LLM extension must satisfy this type via `satisfies ExtensionResult`.
 *
 * Function param shapes (snake_case boundary names):
 *   message    — (prompt: string | list, options?: dict)
 *   tool_loop  — (prompt: string | list, tools: dict, max_turns: number)
 *   generate   — (prompt: string | list, schema: rill type)
 *   embed      — (text: string)
 *   embed_batch — (texts: list)
 *
 * `messages` is removed; all multi-turn call sites use `message` with a list
 * prompt or construct message histories directly.
 */
export type LlmExtensionContract = {
  readonly message: ApplicationCallable;
  readonly embed: ApplicationCallable;
  readonly embed_batch: ApplicationCallable;
  readonly tool_loop: ApplicationCallable;
  readonly generate: ApplicationCallable;
};
