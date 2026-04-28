/**
 * Process manager for Claude CLI spawning and lifecycle.
 * Handles PTY spawn, timeout enforcement, and cleanup.
 */

import * as pty from 'node-pty';
import { SpawnError } from './errors.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Process spawn result.
 * Includes PTY instance and cleanup function.
 */
export interface SpawnResult {
  /** PTY process instance */
  readonly ptyProcess: pty.IPty;
  /** Exit code promise (resolves when process exits) */
  readonly exitCode: Promise<number>;
  /** Cleanup function (kills process if running) */
  readonly dispose: () => void;
}

/**
 * Options for spawning Claude CLI process.
 */
export interface SpawnOptions {
  /** Path to Claude CLI binary (default: 'claude') */
  readonly binaryPath?: string | undefined;
  /** Timeout in milliseconds (kills process after duration) */
  readonly timeoutMs?: number | undefined;
  /** Working directory for process (default: inherit) */
  readonly cwd?: string | undefined;
  /** Environment variables (default: inherit) */
  readonly env?: Record<string, string | undefined> | undefined;
  /** Skip permission checks (default: true) */
  readonly dangerouslySkipPermissions?: boolean | undefined;
  /** Setting sources to load: 'user', 'project', 'local' (default: '') */
  readonly settingSources?: string | undefined;
}

// ============================================================
// SPAWN FUNCTION
// ============================================================

/**
 * Spawn Claude CLI process with timeout enforcement.
 *
 * @param prompt - User prompt to send to Claude
 * @param options - Spawn options
 * @returns Process handle with exit code and cleanup
 * @throws SpawnError on spawn-time failures (callers convert to invalid
 *   RillValues via `mapSpawnError`)
 */
export function spawnClaudeCli(
  prompt: string,
  options: SpawnOptions = {}
): SpawnResult {
  const {
    binaryPath = 'claude',
    timeoutMs,
    cwd = process.cwd(),
    env = process.env,
    dangerouslySkipPermissions = true,
    settingSources = '',
  } = options;

  // Build CLI args
  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--setting-sources',
    settingSources,
  ];
  if (dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  // Track timeout and process state
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  // Create promise for exit code
  let resolveExit: (code: number) => void;
  let rejectExit: (error: Error) => void;

  const exitCode = new Promise<number>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });

  // Spawn process
  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(binaryPath, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd,
      env,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;

      if (code === 'ENOENT') {
        throw new SpawnError('binary_missing', 'claude binary not found', { binaryPath });
      }

      if (code === 'EACCES') {
        throw new SpawnError('binary_eacces', 'Permission denied: claude', { binaryPath });
      }

      throw new SpawnError(
        'spawn_failed',
        `Failed to spawn claude binary: ${error.message}`,
        { binaryPath, originalError: error.message },
      );
    }

    throw new SpawnError(
      'spawn_failed',
      'Failed to spawn claude binary: Unknown error',
      { binaryPath },
    );
  }

  // Set up timeout enforcement
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      if (!disposed) {
        disposed = true;
        ptyProcess.kill();
        rejectExit(
          new SpawnError('cli_timeout', `Claude CLI timeout after ${timeoutMs}ms`, {
            timeoutMs,
          }),
        );
      }
    }, timeoutMs);
  }

  // Handle process exit
  ptyProcess.onExit((event) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!disposed) {
      disposed = true;
      const { exitCode: code } = event;

      // EC-9: Non-zero exit code
      if (code !== 0) {
        rejectExit(
          new SpawnError('exit_nonzero', `Claude CLI exited with code ${code}`, {
            exitCode: code,
          }),
        );
      } else {
        resolveExit(code);
      }
    }
  });

  // Cleanup function
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // EC-16: Cleanup failure warning
    try {
      ptyProcess.kill();
    } catch (error: unknown) {
      // Log warning but don't throw
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to kill claude process during cleanup: ${message}`);
    }
  };

  return {
    ptyProcess,
    exitCode,
    dispose,
  };
}
