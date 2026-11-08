/**
 * Internal scope handed to host-function builders that live outside factory.ts.
 * Mutable factory state (abort controller, usage counters) is reachable only
 * through the accessor functions below, never as copied values, so calls made
 * after dispose() always observe the disposed state.
 */

import type { AzureOpenAI } from 'openai';
import type {
  RuntimeContext,
  RuntimeError,
  RuntimeHaltSignal,
} from '@rcrsr/rill';
import type { ShieldMiddleware } from './safety.js';

export interface FoundryScope {
  readonly client: AzureOpenAI;
  readonly model: string | undefined;
  readonly temperature: number | undefined;
  readonly maxTokens: number;
  readonly system: string | undefined;
  readonly autoShield: ShieldMiddleware | null;
  /** Throws #DISPOSED once the extension has been disposed. */
  readonly assertNotDisposed: (ctx: RuntimeContext) => void;
  /** Throws when inference config is absent or incomplete. */
  readonly assertInference: (ctx: RuntimeContext) => {
    model: string;
    apiVersion: string;
  };
  /** Returns the #DISPOSED halt when dispose() cancelled the call. */
  readonly cancelledByDispose: (
    ctx: RuntimeContext,
    error: unknown
  ) => RuntimeHaltSignal | undefined;
  /** Single failure classifier for host-function catch blocks. */
  readonly classifyError: (
    ctx: RuntimeContext,
    error: unknown
  ) => RuntimeError | RuntimeHaltSignal;
  /** Adds one call's token counts to the factory usage totals. */
  readonly accumulateUsage: (input: number, output: number) => void;
  /** Current request abort signal; throws #DISPOSED after dispose(). */
  readonly getAbortSignal: (ctx: RuntimeContext) => AbortSignal;
}
