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
import { RuntimeError } from '@rcrsr/rill';
import type { CommandConfig, CommandResult } from './types.js';

const execFileAsync = promisify(execFile);

// ----------------------------------------------------------
// Validation
// ----------------------------------------------------------

function validateArgs(
  args: readonly string[],
  config: CommandConfig,
  commandName: string,
): void {
  const { allowedArgs, blockedArgs } = config;

  if (allowedArgs !== undefined) {
    for (const arg of args) {
      if (!allowedArgs.includes(arg)) {
        throw new RuntimeError(
          'RILL-R004',
          `arg "${arg}" not permitted for command "${commandName}"`,
          undefined,
          { commandName, arg, allowedArgs },
        );
      }
    }
  }

  if (blockedArgs !== undefined) {
    for (const arg of args) {
      if (blockedArgs.includes(arg)) {
        throw new RuntimeError(
          'RILL-R004',
          `arg "${arg}" is blocked for command "${commandName}"`,
          undefined,
          { commandName, arg, blockedArgs },
        );
      }
    }
  }
}

function validateStdin(
  config: CommandConfig,
  commandName: string,
  hasStdin: boolean,
): void {
  if (hasStdin && !config.stdin) {
    throw new RuntimeError(
      'RILL-R004',
      `command "${commandName}" does not support stdin`,
      undefined,
      { commandName },
    );
  }
}

// ----------------------------------------------------------
// Execution
// ----------------------------------------------------------

/**
 * Execute command with process spawning and security controls.
 *
 * Uses execFile() to prevent shell injection attacks.
 * Non-zero exit code is returned as part of the result, not thrown.
 */
export async function runCommand(
  commandName: string,
  config: CommandConfig,
  args: readonly string[],
  stdinData?: string | undefined,
  signal?: AbortSignal | undefined,
): Promise<CommandResult> {
  validateArgs(args, config, commandName);
  validateStdin(config, commandName, stdinData !== undefined);

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
    if (err && typeof err === 'object') {
      const execError = err as {
        code?: string;
        killed?: boolean;
        signal?: string | null;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      if (execError.code === 'ENOENT') {
        throw new RuntimeError(
          'RILL-R004',
          `binary not found: ${config.binary}`,
          undefined,
          { commandName, binary: config.binary },
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
        throw new RuntimeError(
          'RILL-R004',
          `command output exceeds size limit`,
          undefined,
          { commandName, maxBuffer: config.maxBuffer },
        );
      }

      if (execError.killed === true && execError.signal === 'SIGTERM') {
        const timeoutMs = config.timeout || 0;
        throw new RuntimeError(
          'RILL-R012',
          `command "${commandName}" timed out (${timeoutMs}ms)`,
          undefined,
          { commandName, timeoutMs },
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
