/**
 * Error mapping utilities for the claude-code extension.
 *
 * Spawn-time and process-lifecycle failures decompose into a typed
 * `SpawnError` that callers map to invalid `RillValue`s via `ctx.invalidate`
 * using rill core's pre-registered generic atoms.
 */

import {
  RuntimeHaltSignal,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

const PROVIDER = 'claude-code';

export type SpawnErrorKind =
  | 'binary_missing'
  | 'binary_eacces'
  | 'spawn_failed'
  | 'cli_timeout'
  | 'exit_nonzero';

/**
 * Typed error thrown by `spawnClaudeCli` and rejected from the exit promise.
 * Callers convert these to invalid `RillValue`s through `mapSpawnError`.
 */
export class SpawnError extends Error {
  readonly kind: SpawnErrorKind;
  readonly extra: Record<string, unknown>;

  constructor(
    kind: SpawnErrorKind,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.kind = kind;
    this.extra = extra;
    this.name = 'SpawnError';
  }
}

/**
 * Map a `SpawnError` (or an error caught from a PTY-related thunk) to an
 * invalid `RillValue` using `ctx.invalidate`.
 *
 * - `binary_missing` → `#UNAVAILABLE`
 * - `binary_eacces` → `#FORBIDDEN`
 * - `spawn_failed` → `#UNAVAILABLE`
 * - `cli_timeout` → `#TIMEOUT`
 * - `exit_nonzero` → `#UNAVAILABLE`
 * - `RuntimeHaltSignal` carrying `#TIMEOUT` → `#TIMEOUT` (cooperative cancel)
 * - anything else → `#UNAVAILABLE` with `kind: 'unknown_error'`.
 */
export function mapSpawnError(ctx: RuntimeContext, error: unknown): RillValue {
  if (error instanceof SpawnError) {
    const code = codeForKind(error.kind);
    return ctx.invalidate(error, {
      code,
      provider: PROVIDER,
      raw: { kind: error.kind, message: error.message, ...error.extra },
    });
  }

  if (
    error instanceof RuntimeHaltSignal &&
    getStatus(error.value).code.name === 'TIMEOUT'
  ) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'request_cancelled' },
    });
  }

  const detail = error instanceof Error ? error.message : String(error);
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'unknown_error', message: detail },
  });
}

function codeForKind(kind: SpawnErrorKind):
  | 'UNAVAILABLE'
  | 'FORBIDDEN'
  | 'TIMEOUT' {
  switch (kind) {
    case 'binary_eacces':
      return 'FORBIDDEN';
    case 'cli_timeout':
      return 'TIMEOUT';
    default:
      return 'UNAVAILABLE';
  }
}
