/**
 * Error mapping utilities for the MCP extension (rill 0.19+).
 *
 * Factory-time validation throws `RuntimeError('RILL-R001', ...)`.
 * Runtime failures decompose into `(generic atom, meta.provider='mcp',
 * meta.raw.kind)` tuples emitted via `ctx.invalidate`.
 *
 * Callers `throw fail*(...)`. The wrapper / outer catch detects invalid
 * `RillValue`s via `isInvalid` and passes them through unchanged.
 */

import {
  RuntimeError,
  isInvalid,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';

const PROVIDER = 'mcp';

// ============================================================
// FACTORY-TIME ERRORS (sync, before any host fn runs)
// ============================================================

/**
 * Build a factory-time `RuntimeError(RILL-R001)` for invalid configuration
 * or transport-construction failures.
 */
export function factoryError(
  message: string,
  context?: Record<string, unknown>
): RuntimeError {
  return new RuntimeError('RILL-R001', `mcp: ${message}`, undefined, context);
}

/**
 * Stdio-only: server process exited with the given code.
 */
export function processExitError(exitCode: number): RuntimeError {
  return factoryError(`server process exited with code ${exitCode}`, {
    exitCode,
  });
}

/**
 * HTTP-only: connection refused at the given URL.
 */
export function connectionRefusedError(url: string): RuntimeError {
  return factoryError(`connection refused at ${url}`, { url });
}

/**
 * HTTP-only: server requires authentication.
 */
export function authRequiredError(): RuntimeError {
  return factoryError(
    'server requires authentication -- complete OAuth flow before connecting',
    { kind: 'auth_required' }
  );
}

// ============================================================
// RUNTIME ERRORS (host fns; emitted via ctx.invalidate)
// ============================================================

/** Tool execution failed with an explicit error response. */
export function failTool(
  ctx: RuntimeContext,
  toolName: string,
  errorText: string
): RillValue {
  return ctx.invalidate(new Error(`mcp tool "${toolName}": ${errorText}`), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'tool_error', toolName, errorText },
  });
}

/** Tool / resource / prompt name not found on the server. */
export function failNotFound(
  ctx: RuntimeContext,
  callableName: string,
  detail?: string
): RillValue {
  return ctx.invalidate(
    new Error(`mcp: not found "${callableName}"${detail ? `: ${detail}` : ''}`),
    {
      code: 'NOT_FOUND',
      provider: PROVIDER,
      raw: { kind: 'not_found', name: callableName, detail },
    }
  );
}

/** Malformed protocol response or schema mismatch. */
export function failProtocol(ctx: RuntimeContext, message: string): RillValue {
  return ctx.invalidate(new Error(`mcp: protocol error -- ${message}`), {
    code: 'PROTOCOL',
    provider: PROVIDER,
    raw: { kind: 'protocol_error', detail: message },
  });
}

/** Operation exceeded the configured timeout. */
export function failTimeout(
  ctx: RuntimeContext,
  callableName: string,
  timeoutMs: number
): RillValue {
  return ctx.invalidate(
    new Error(`mcp tool "${callableName}": timeout after ${timeoutMs}ms`),
    {
      code: 'TIMEOUT',
      provider: PROVIDER,
      raw: { kind: 'tool_timeout', name: callableName, timeoutMs },
    }
  );
}

/** Transport disconnected during an in-flight operation. */
export function failConnectionLost(ctx: RuntimeContext): RillValue {
  return ctx.invalidate(new Error('mcp: connection lost'), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'connection_lost' },
  });
}

/** Authentication required or token rejected. */
export function failAuth(ctx: RuntimeContext): RillValue {
  return ctx.invalidate(
    new Error('mcp: authentication failed -- token may be expired'),
    {
      code: 'AUTH',
      provider: PROVIDER,
      raw: { kind: 'auth_failed' },
    }
  );
}

/** Bad input from the host script. */
export function failInput(
  ctx: RuntimeContext,
  message: string,
  raw: Record<string, unknown> = {}
): RillValue {
  return ctx.invalidate(new Error(`mcp: ${message}`), {
    code: 'INVALID_INPUT',
    provider: PROVIDER,
    raw: { kind: 'invalid_input', ...raw },
  });
}

/** Generic unavailable error (server unreachable, 5xx, network failure). */
export function failUnavailable(
  ctx: RuntimeContext,
  message: string,
  raw: Record<string, unknown> = {}
): RillValue {
  return ctx.invalidate(new Error(`mcp: ${message}`), {
    code: 'UNAVAILABLE',
    provider: PROVIDER,
    raw: { kind: 'unknown_error', detail: message, ...raw },
  });
}

// ============================================================
// CATCH-BLOCK MAPPER
// ============================================================

/**
 * Map an unknown error caught around an MCP SDK call to an invalid RillValue
 * via `ctx.invalidate`. Existing invalid values pass through unchanged.
 */
export function mapMcpError(
  ctx: RuntimeContext,
  error: unknown,
  callableName: string
): RillValue {
  // Already an invalid RillValue thrown by an inner helper: pass through.
  if (isInvalid(error as RillValue)) {
    return error as RillValue;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes('connection closed') ||
      message.includes('connection lost') ||
      message.includes('disconnected')
    ) {
      return failConnectionLost(ctx);
    }

    if (
      message.includes('unauthorized') ||
      message.includes('authentication failed') ||
      message.includes('token') ||
      (message.includes('auth') && !message.includes('author'))
    ) {
      return failAuth(ctx);
    }

    if (
      message.includes('protocol') ||
      message.includes('invalid response') ||
      message.includes('parse') ||
      message.includes('malformed')
    ) {
      return failProtocol(ctx, error.message);
    }

    return failTool(ctx, callableName, error.message);
  }

  return failTool(ctx, callableName, String(error));
}
