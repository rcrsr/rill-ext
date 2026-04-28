/**
 * Error mapping utilities for kv extensions.
 *
 * Converts SDK errors (ioredis, better-sqlite3) into invalid RillValues via
 * `ctx.invalidate`, using rill core's pre-registered generic atoms.
 */

import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

interface ErrorWithCode {
  code?: string;
  message?: string;
  name?: string;
}

/**
 * Map a kv SDK error to an invalid RillValue.
 *
 * @param ctx - Runtime context (provides `invalidate`)
 * @param provider - Provider name (e.g. "kv-redis", "kv-sqlite")
 * @param error - Error caught from a kv operation
 */
export function mapKvError(
  ctx: RuntimeContext,
  provider: string,
  error: unknown,
): RillValue {
  if (error instanceof RuntimeHaltSignal) {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_cancelled', message: `${provider}: request cancelled` },
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_timeout', message: `${provider}: request timeout` },
    });
  }

  const err = error as ErrorWithCode;
  const message = err?.message ?? String(error);

  // ioredis / Node connection errors
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND') {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'connection_failed', code: err.code, message },
    });
  }

  // ioredis MaxRetriesPerRequestError
  if (err?.name === 'MaxRetriesPerRequestError') {
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'max_retries_exceeded', message },
    });
  }

  // Redis auth errors come back as messages prefixed NOAUTH / WRONGPASS
  if (typeof message === 'string' && (message.includes('NOAUTH') || message.includes('WRONGPASS'))) {
    return ctx.invalidate(error, {
      code: 'AUTH',
      provider,
      raw: { kind: 'authentication_failed', message },
    });
  }

  // better-sqlite3 throws SqliteError with .code like SQLITE_CONSTRAINT, SQLITE_BUSY
  if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_')) {
    if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
      return ctx.invalidate(error, {
        code: 'CONFLICT',
        provider,
        raw: { kind: 'database_busy', code: err.code, message },
      });
    }
    if (err.code === 'SQLITE_READONLY') {
      return ctx.invalidate(error, {
        code: 'FORBIDDEN',
        provider,
        raw: { kind: 'database_readonly', code: err.code, message },
      });
    }
    return ctx.invalidate(error, {
      code: 'UNAVAILABLE',
      provider,
      raw: { kind: 'database_error', code: err.code, message },
    });
  }

  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider,
    raw: { kind: 'unknown_error', message: `${provider}: ${message}` },
  });
}
