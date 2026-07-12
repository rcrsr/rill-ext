/**
 * Extension factory for Claude Code integration.
 * Creates extension instance with config validation and process lifecycle management.
 */

import which from 'which';
import {
  RuntimeError,
  createRillStream,
  emitExtensionEvent,
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { p } from '@rcrsr/rill-ext-param-shared';
import type { ClaudeCodeConfig, ClaudeMessage } from './types.js';
import { spawnClaudeCli } from './process.js';
import { createStreamParser } from './stream-parser.js';
import { extractResult } from './result.js';
import { mapSpawnError } from './errors.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Active process tracker for cleanup.
 */
interface ProcessTracker {
  /** Active process cleanup functions */
  readonly disposers: Set<() => void>;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_BINARY_PATH = 'claude';
const DEFAULT_TIMEOUT = 1800000;
const MAX_TIMEOUT = 3600000;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Serialize dict args to CLI flags for skill/command.
 * Boolean true values become flags without value, nested dicts use dot-notation.
 *
 * @param args - Dict of arguments to serialize
 * @returns Array of CLI flag strings
 */
function serializeArgsToFlags(args: Record<string, unknown>): string[] {
  const flags: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (value === true) {
      // Boolean true: flag without value
      flags.push(`--${key}`);
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Nested dict: dot-notation
      const nested = value as Record<string, unknown>;
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        flags.push(`--${key}.${nestedKey}`, String(nestedValue));
      }
    } else {
      // Other values: key-value pair
      flags.push(`--${key}`, String(value));
    }
  }

  return flags;
}

/**
 * Truncate text to max length for event logging.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 100)
 * @returns Truncated text with ellipsis if needed
 */
function truncateText(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

// ============================================================
// STREAM HELPER
// ============================================================

/**
 * Options for createPtyStream event emission.
 */
interface PtyStreamEventOptions {
  /** Event name (e.g. 'claude-code:prompt') */
  readonly event: string;
  /** Additional fields to include in the emitted event */
  readonly eventData: Record<string, unknown>;
}

/**
 * Bridge a PTY SpawnResult into a RillStream.
 *
 * The async generator converts push-based onData callbacks to a pull-based
 * async iteration. Each raw PTY line is yielded as a string chunk.
 * On non-zero exit (EC-10), an error chunk is yielded and the stream resolves
 * with partial data rather than throwing.
 *
 * @param spawn - Spawned PTY process handle
 * @param tracker - Active process tracker for cleanup registration
 * @param ctx - Runtime context for event emission
 * @param eventOpts - Event name and extra fields for emission on resolve
 * @returns RillStream value
 */
function createPtyStream(
  spawn: import('./process.js').SpawnResult,
  tracker: ProcessTracker,
  ctx: RuntimeContext,
  eventOpts: PtyStreamEventOptions
): RillValue {
  // Accumulate parsed messages for the resolve callback
  const messages: ClaudeMessage[] = [];
  const parser = createStreamParser();

  // Shared state for push-to-pull bridge — declared at createPtyStream scope so
  // exitCode.then() attaches immediately (not lazily inside the generator).
  // This prevents unhandled rejections when exitCode rejects before the first next().
  const lineBuffer: string[] = [];
  let done = false;
  let errorMessage: string | undefined;
  let resolveWaiter: (() => void) | undefined;

  function wake(): void {
    if (resolveWaiter) {
      const fn = resolveWaiter;
      resolveWaiter = undefined;
      fn();
    }
  }

  // onData pushes raw PTY chunks; lines are buffered for pull iteration.
  spawn.ptyProcess.onData((chunk) => {
    const rawText =
      typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');

    // Split into lines and buffer non-empty ones for yielding
    for (const line of rawText.split('\n')) {
      if (line.length > 0) {
        lineBuffer.push(line);
      }
    }

    // Parse chunk to accumulate structured messages
    parser.processChunk(chunk, (msg) => messages.push(msg));

    wake();
  });

  // Monitor exit promise — attach immediately to prevent unhandled rejections.
  // EC-9: Timeout — re-throw RuntimeError so the generator propagates it to the consumer.
  // EC-10: Non-zero exit — yield error chunk, resolve with partial data.
  // Track the original error so resolve() can map it to a precise generic
  // atom via mapSpawnError. Timeout, non-zero exit, and other rejections all
  // surface as an [error] chunk plus a captured `exitError`. resolve() turns
  // any captured error into an invalid RillValue.
  let exitError: unknown;

  const exitPromise = spawn.exitCode.then(
    () => {
      parser.flush((msg) => messages.push(msg));
      done = true;
      wake();
    },
    (error: unknown) => {
      parser.flush((msg) => messages.push(msg));
      done = true;
      exitError = error;
      errorMessage = error instanceof Error ? error.message : 'Unknown error';
      lineBuffer.push(`[error] ${errorMessage}`);
      wake();
    }
  );
  // Suppress unhandled-rejection for the timeout path: exitPromise may reject before
  // the generator or resolve callback awaits it. The rejection is handled at await sites.
  exitPromise.catch(() => undefined);

  // Async generator bridges push-based onData to pull-based iteration.
  async function* chunks(): AsyncGenerator<RillValue> {
    // Pull loop: yield buffered lines, wait when buffer is empty
    while (!done || lineBuffer.length > 0) {
      if (lineBuffer.length === 0) {
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
      }
      while (lineBuffer.length > 0) {
        yield lineBuffer.shift() as string;
      }
    }

    await exitPromise;
  }

  const retTypeStructure = {
    kind: 'dict' as const,
    fields: {
      result: { type: { kind: 'string' as const } },
      tokens: {
        type: {
          kind: 'dict' as const,
          fields: {
            prompt: { type: { kind: 'number' as const } },
            cache_write_5m: { type: { kind: 'number' as const } },
            cache_write_1h: { type: { kind: 'number' as const } },
            cache_read: { type: { kind: 'number' as const } },
            output: { type: { kind: 'number' as const } },
          },
        },
      },
      cost: { type: { kind: 'number' as const } },
      exit_code: { type: { kind: 'number' as const } },
      duration: { type: { kind: 'number' as const } },
    },
  };

  // Resolve callback: called after chunk exhaustion, returns same dict as pre-streaming.
  // On error path, emits claude-code:error event instead of the success event.
  // Awaits exitPromise to ensure errorMessage and messages are populated even when
  // the caller resolves via __rill_stream_resolve() without iterating chunks.
  const resolve = async (): Promise<RillValue> => {
    await exitPromise;
    // Timeout (`SpawnError` 'cli_timeout') maps to `#TIMEOUT`. Any other
    // exit-promise rejection (non-zero exit, network error, etc.) maps via
    // `mapSpawnError` so the host script sees a precise generic atom rather
    // than a thrown plain Error.
    if (exitError !== undefined) {
      emitExtensionEvent(ctx, {
        event: 'claude-code:error',
        subsystem: 'extension:claude-code',
        error: exitError instanceof Error ? exitError.message : 'Unknown error',
        duration: 0,
      });
      tracker.disposers.delete(spawn.dispose);
      spawn.dispose();
      return mapSpawnError(ctx, exitError);
    }
    const startTime = Date.now();
    const result = extractResult(messages);
    const duration = Date.now() - startTime;

    if (errorMessage !== undefined) {
      emitExtensionEvent(ctx, {
        event: 'claude-code:error',
        subsystem: 'extension:claude-code',
        error: errorMessage,
        duration,
      });
    } else {
      emitExtensionEvent(ctx, {
        event: eventOpts.event,
        subsystem: 'extension:claude-code',
        ...eventOpts.eventData,
        duration,
      });
    }

    tracker.disposers.delete(spawn.dispose);
    spawn.dispose();

    return {
      ...result,
      tokens: { ...result.tokens } as { [key: string]: RillValue },
    } as RillValue;
  };

  return createRillStream({
    chunks: chunks(),
    resolve,
    dispose: () => {
      tracker.disposers.delete(spawn.dispose);
      spawn.dispose();
    },
    chunkType: { kind: 'string' },
    retType: retTypeStructure,
  }) as RillValue;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate timeout is positive integer within bounds.
 *
 * @param timeout - Timeout in milliseconds
 * @throws Error if timeout invalid
 */
function validateTimeout(timeout: number): void {
  if (!Number.isInteger(timeout)) {
    throw new Error('Invalid timeout: must be positive integer, max 3600000');
  }

  if (timeout <= 0) {
    throw new Error('Invalid timeout: must be positive integer, max 3600000');
  }

  if (timeout > MAX_TIMEOUT) {
    throw new Error('Invalid timeout: must be positive integer, max 3600000');
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create Claude Code extension instance.
 * Validates configuration and returns host functions with cleanup.
 *
 * @param config - Extension configuration
 * @returns ExtensionResult with prompt, skill, command functions and dispose
 * @throws Error for invalid configuration (EC-1, EC-2)
 *
 * @example
 * ```typescript
 * const ext = createClaudeCodeExtension({
 *   binaryPath: '/usr/local/bin/claude',
 *   defaultTimeout: 60000
 * });
 * // Use with rill runtime...
 * await ext.dispose();
 * ```
 */
export function createClaudeCodeExtension(
  config: ClaudeCodeConfig = {},
  factoryCtx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  // Extract config with defaults
  const binaryPath = config.binaryPath ?? DEFAULT_BINARY_PATH;
  const defaultTimeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;
  const dangerouslySkipPermissions = config.dangerouslySkipPermissions ?? true;
  const settingSources = config.settingSources ?? '';

  // Validate timeout immediately
  validateTimeout(defaultTimeout);

  // Validate binary path eagerly (sync throw if not in PATH)
  try {
    which.sync(binaryPath);
  } catch {
    throw new RuntimeError(
      'RILL-R001',
      `claude-code: claude binary not found: ${binaryPath}`,
      undefined,
      { binaryPath }
    );
  }

  // Track active processes for cleanup
  const tracker: ProcessTracker = {
    disposers: new Set(),
  };

  // Dispose function for cleanup
  const dispose = (): void => {
    // EC-16: Cleanup failure logs warning, doesn't throw
    for (const disposer of tracker.disposers) {
      try {
        disposer();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Failed to cleanup process: ${message}`);
      }
    }
    tracker.disposers.clear();
  };

  // Wire ctx.signal: aborting the factory signal kills all in-flight PTYs.
  factoryCtx.signal.addEventListener('abort', () => dispose(), { once: true });

  // Return extension result with implementations
  const fnDict: {
    prompt: RillFunction;
    skill: RillFunction;
    command: RillFunction;
  } = {
    // IR-2: claude-code::prompt
    prompt: {
      params: [
        p.str('text'),
        p.dict(
          'options',
          undefined,
          {},
          {
            timeout: { type: { kind: 'number' }, defaultValue: 0 },
          }
        ),
      ],
      fn: (args, ctxLike): RillValue => {
        const ctx = ctxLike as RuntimeContext;
        const text = args['text'] as string;
        const options = (args['options'] ?? {}) as Record<string, unknown>;

        // EC-7: Validate text is non-empty (before stream creation)
        if (text.trim().length === 0) {
          throw ctx.invalidate(new Error('prompt text cannot be empty'), {
            code: 'INVALID_INPUT',
            provider: 'claude-code',
            raw: { kind: 'empty_text' },
          }) as unknown as RillValue;
        }

        const timeout =
          typeof options['timeout'] === 'number'
            ? options['timeout']
            : defaultTimeout;

        let spawn: import('./process.js').SpawnResult;
        try {
          spawn = spawnClaudeCli(text, {
            binaryPath,
            timeoutMs: timeout,
            dangerouslySkipPermissions,
            settingSources,
          });
        } catch (error: unknown) {
          throw mapSpawnError(ctx, error) as unknown as RillValue;
        }

        tracker.disposers.add(spawn.dispose);
        ctx.signal?.addEventListener('abort', spawn.dispose, { once: true });

        return createPtyStream(spawn, tracker, ctx, {
          event: 'claude-code:prompt',
          eventData: { prompt: truncateText(text) },
        });
      },
      annotations: {
        description:
          'Execute Claude Code prompt and return result text and token usage',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: {
          kind: 'dict',
          fields: {
            result: { type: { kind: 'string' } },
            tokens: {
              type: {
                kind: 'dict',
                fields: {
                  prompt: { type: { kind: 'number' } },
                  cache_write_5m: { type: { kind: 'number' } },
                  cache_write_1h: { type: { kind: 'number' } },
                  cache_read: { type: { kind: 'number' } },
                  output: { type: { kind: 'number' } },
                },
              },
            },
            cost: { type: { kind: 'number' } },
            exit_code: { type: { kind: 'number' } },
            duration: { type: { kind: 'number' } },
          },
        },
      }),
    },

    // IR-3: claude-code::skill
    skill: {
      params: [
        p.str('name'),
        p.dict(
          'args',
          undefined,
          {},
          {
            timeout: { type: { kind: 'number' }, defaultValue: 0 },
          }
        ),
      ],
      fn: (fnArgs, ctxLike): RillValue => {
        const ctx = ctxLike as RuntimeContext;
        const name = fnArgs['name'] as string;
        const args = (fnArgs['args'] ?? {}) as Record<string, unknown>;

        // EC-7: Validate name is non-empty (before stream creation)
        if (name.trim().length === 0) {
          throw ctx.invalidate(new Error('skill name cannot be empty'), {
            code: 'INVALID_INPUT',
            provider: 'claude-code',
            raw: { kind: 'empty_skill_name' },
          }) as unknown as RillValue;
        }

        const flags = serializeArgsToFlags(args);
        const flagsText = flags.length > 0 ? ' ' + flags.join(' ') : '';
        const prompt = `/${name}${flagsText}`;

        const timeout =
          typeof args['timeout'] === 'number'
            ? args['timeout']
            : defaultTimeout;

        let spawn: import('./process.js').SpawnResult;
        try {
          spawn = spawnClaudeCli(prompt, {
            binaryPath,
            timeoutMs: timeout,
            dangerouslySkipPermissions,
            settingSources,
          });
        } catch (error: unknown) {
          throw mapSpawnError(ctx, error) as unknown as RillValue;
        }

        tracker.disposers.add(spawn.dispose);
        ctx.signal?.addEventListener('abort', spawn.dispose, { once: true });

        return createPtyStream(spawn, tracker, ctx, {
          event: 'claude-code:skill',
          eventData: { name, args },
        });
      },
      annotations: {
        description:
          'Execute Claude Code skill with instruction and return structured result',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: {
          kind: 'dict',
          fields: {
            result: { type: { kind: 'string' } },
            tokens: {
              type: {
                kind: 'dict',
                fields: {
                  prompt: { type: { kind: 'number' } },
                  cache_write_5m: { type: { kind: 'number' } },
                  cache_write_1h: { type: { kind: 'number' } },
                  cache_read: { type: { kind: 'number' } },
                  output: { type: { kind: 'number' } },
                },
              },
            },
            cost: { type: { kind: 'number' } },
            exit_code: { type: { kind: 'number' } },
            duration: { type: { kind: 'number' } },
          },
        },
      }),
    },

    // IR-4: claude-code::command
    command: {
      params: [
        p.str('name'),
        p.dict(
          'args',
          undefined,
          {},
          {
            timeout: { type: { kind: 'number' }, defaultValue: 0 },
          }
        ),
      ],
      fn: (fnArgs, ctxLike): RillValue => {
        const ctx = ctxLike as RuntimeContext;
        const name = fnArgs['name'] as string;
        const args = (fnArgs['args'] ?? {}) as Record<string, unknown>;

        // EC-7: Validate name is non-empty (before stream creation)
        if (name.trim().length === 0) {
          throw ctx.invalidate(new Error('command name cannot be empty'), {
            code: 'INVALID_INPUT',
            provider: 'claude-code',
            raw: { kind: 'empty_command_name' },
          }) as unknown as RillValue;
        }

        const flags = serializeArgsToFlags(args);
        const flagsText = flags.length > 0 ? ' ' + flags.join(' ') : '';
        const prompt = `/${name}${flagsText}`;

        const timeout =
          typeof args['timeout'] === 'number'
            ? args['timeout']
            : defaultTimeout;

        let spawn: import('./process.js').SpawnResult;
        try {
          spawn = spawnClaudeCli(prompt, {
            binaryPath,
            timeoutMs: timeout,
            dangerouslySkipPermissions,
            settingSources,
          });
        } catch (error: unknown) {
          throw mapSpawnError(ctx, error) as unknown as RillValue;
        }

        tracker.disposers.add(spawn.dispose);
        ctx.signal?.addEventListener('abort', spawn.dispose, { once: true });

        return createPtyStream(spawn, tracker, ctx, {
          event: 'claude-code:command',
          eventData: { name, args },
        });
      },
      annotations: {
        description:
          'Execute Claude Code command with task description and return execution summary',
      },
      returnType: structureToTypeValue({
        kind: 'stream',
        chunk: { kind: 'string' },
        ret: {
          kind: 'dict',
          fields: {
            result: { type: { kind: 'string' } },
            tokens: {
              type: {
                kind: 'dict',
                fields: {
                  prompt: { type: { kind: 'number' } },
                  cache_write_5m: { type: { kind: 'number' } },
                  cache_write_1h: { type: { kind: 'number' } },
                  cache_read: { type: { kind: 'number' } },
                  output: { type: { kind: 'number' } },
                },
              },
            },
            cost: { type: { kind: 'number' } },
            exit_code: { type: { kind: 'number' } },
            duration: { type: { kind: 'number' } },
          },
        },
      }),
    },
  };

  const callableDict = {
    prompt: toCallable(fnDict.prompt),
    skill: toCallable(fnDict.skill),
    command: toCallable(fnDict.command),
  };

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
