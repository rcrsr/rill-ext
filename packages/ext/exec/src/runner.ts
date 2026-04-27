/**
 * Exec extension runner.
 *
 * Handles process spawning with argument validation and security controls.
 * Uses child_process.execFile() for shell injection prevention.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  RuntimeHaltSignal,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import type { CommandConfig, CommandResult } from './types.js';
import { EXT_EXEC_CONFIG, EXT_EXEC_TIMEOUT } from './errors.js';

const execFileAsync = promisify(execFile);
const PROVIDER = 'exec';

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------

function validateArgs(
  args: readonly string[],
  config: CommandConfig,
  commandName: string,
  ctx: RuntimeContext,
): RillValue | null {
  const { allowedArgs, blockedArgs } = config;

  if (allowedArgs !== undefined) {
    for (const arg of args) {
      if (!allowedArgs.includes(arg)) {
        return ctx.invalidate(
          new Error(`arg "${arg}" not permitted for command "${commandName}"`),
          {
            code: EXT_EXEC_CONFIG,
            provider: PROVIDER,
            raw: {
              kind: 'arg_not_permitted',
              commandName,
              arg,
              allowedArgs: [...allowedArgs],
            },
          },
        );
      }
    }
  }

  if (blockedArgs !== undefined) {
    for (const arg of args) {
      if (blockedArgs.includes(arg)) {
        return ctx.invalidate(
          new Error(`arg "${arg}" is blocked for command "${commandName}"`),
          {
            code: EXT_EXEC_CONFIG,
            provider: PROVIDER,
            raw: {
              kind: 'arg_blocked',
              commandName,
              arg,
              blockedArgs: [...blockedArgs],
            },
          },
        );
      }
    }
  }

  return null;
}

function validateStdin(
  config: CommandConfig,
  commandName: string,
  hasStdin: boolean,
  ctx: RuntimeContext,
): RillValue | null {
  if (hasStdin && !config.stdin) {
    return ctx.invalidate(
      new Error(`command "${commandName}" does not support stdin`),
      {
        code: EXT_EXEC_CONFIG,
        provider: PROVIDER,
        raw: { kind: 'stdin_not_supported', commandName },
      },
    );
  }
  return null;
}

// ----------------------------------------------------------
// Execution
// ----------------------------------------------------------

/**
 * Execute command with process spawning and security controls.
 *
 * Uses execFile() to prevent shell injection attacks.
 * Non-zero exit code is returned as part of the result, not thrown.
 *
 * Returns either a CommandResult (success path) or an invalid RillValue
 * (validation/exec failure). Callers must check via `isInvalid()`.
 */
export async function runCommand(
  commandName: string,
  config: CommandConfig,
  args: readonly string[],
  stdinData: string | undefined,
  signal: AbortSignal | undefined,
  ctx: RuntimeContext,
): Promise<CommandResult | RillValue> {
  const argInvalid = validateArgs(args, config, commandName, ctx);
  if (argInvalid !== null) return argInvalid;

  const stdinInvalid = validateStdin(
    config,
    commandName,
    stdinData !== undefined,
    ctx,
  );
  if (stdinInvalid !== null) return stdinInvalid;

  const options: {
    timeout?: number;
    maxBuffer?: number;
    encoding: 'utf8';
    input?: string;
    cwd?: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
  } = {
    encoding: 'utf8',
  };

  if (config.timeout !== undefined) {
    options.timeout = config.timeout;
  }
  if (config.maxBuffer !== undefined) {
    options.maxBuffer = config.maxBuffer;
  }
  if (config.cwd !== undefined) {
    options.cwd = config.cwd;
  }
  if (config.env !== undefined) {
    options.env = config.env;
  }
  if (stdinData !== undefined) {
    options.input = stdinData;
  }
  if (signal !== undefined) {
    options.signal = signal;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      config.binary,
      args as string[],
      options,
    );

    return {
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      exitCode: 0,
    };
  } catch (err: unknown) {
    if (err instanceof RuntimeHaltSignal) {
      throw err;
    }

    if (err && typeof err === 'object') {
      const execError = err as {
        code?: string;
        killed?: boolean;
        signal?: string | null;
        stdout?: string;
        stderr?: string;
        message?: string;
        name?: string;
      };

      if (execError.code === 'ENOENT') {
        return ctx.invalidate(
          new Error(`binary not found: ${config.binary}`),
          {
            code: EXT_EXEC_CONFIG,
            provider: PROVIDER,
            raw: {
              kind: 'binary_not_found',
              commandName,
              binary: config.binary,
            },
          },
        );
      }

      const isMaxBufferError =
        execError.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER' ||
        execError.code === 'ERR_CHILD_PROCESS_STDERR_MAXBUFFER' ||
        (execError.message &&
          execError.message.toLowerCase().includes('maxbuffer')) ||
        (execError.killed === true &&
          execError.signal === 'SIGTERM' &&
          config.maxBuffer !== undefined);

      if (isMaxBufferError) {
        return ctx.invalidate(
          new Error('command output exceeds size limit'),
          {
            code: EXT_EXEC_CONFIG,
            provider: PROVIDER,
            raw: {
              kind: 'maxbuffer_exceeded',
              commandName,
              maxBuffer: config.maxBuffer,
            },
          },
        );
      }

      if (execError.killed === true && execError.signal === 'SIGTERM') {
        const timeoutMs = config.timeout || 0;
        return ctx.invalidate(
          new Error(`command "${commandName}" timed out (${timeoutMs}ms)`),
          {
            code: EXT_EXEC_TIMEOUT,
            provider: PROVIDER,
            raw: { kind: 'timeout', commandName, timeoutMs },
          },
        );
      }

      // AbortError (signal-based abort) — surface as timeout-equivalent
      if (
        execError.name === 'AbortError' ||
        execError.code === 'ABORT_ERR'
      ) {
        return ctx.invalidate(
          new Error(`command "${commandName}" aborted`),
          {
            code: EXT_EXEC_TIMEOUT,
            provider: PROVIDER,
            raw: { kind: 'aborted', commandName },
          },
        );
      }

      if ('stdout' in execError && 'stderr' in execError) {
        const exitCode =
          'code' in err && typeof (err as { code: unknown }).code === 'number'
            ? ((err as { code: number }).code as number)
            : 1;

        return {
          stdout: String(execError.stdout || ''),
          stderr: String(execError.stderr || ''),
          exitCode,
        };
      }
    }

    throw err;
  }
}
