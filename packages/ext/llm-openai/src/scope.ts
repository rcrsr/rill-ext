/**
 * Internal scope handed to host-function builders that live outside factory.ts.
 * Mutable factory state (the abort controller) is reachable only through the
 * accessor functions below, so a call made after dispose() always observes it.
 */

import type OpenAI from 'openai';
import type { RuntimeContext } from '@rcrsr/rill';

export interface OpenAIScope {
  readonly client: OpenAI;
  readonly model: string;
  readonly temperature: number | undefined;
  readonly maxTokens: number;
  readonly system: string | undefined;
  readonly maxTurns: number | undefined;
  readonly maxErrors: number | undefined;
  readonly extra: Readonly<Record<string, unknown>> | undefined;
  /** Throws #DISPOSED once the extension has been disposed. */
  readonly assertNotDisposed: (ctx: RuntimeContext) => void;
  /** Throws #DISPOSED when dispose() is what cancelled the call. */
  readonly haltIfCancelledByDispose: (
    ctx: RuntimeContext,
    error: unknown,
    startTime?: number
  ) => void;
  /** Current request abort signal; throws #DISPOSED after dispose(). */
  readonly getAbortSignal: (ctx: RuntimeContext) => AbortSignal;
}
