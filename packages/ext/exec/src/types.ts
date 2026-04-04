/**
 * Type definitions for exec extension.
 *
 * @module
 */

/** Command configuration with security controls. */
export interface CommandConfig {
  /** Binary executable path */
  readonly binary: string;
  /** Optional timeout in milliseconds */
  readonly timeout?: number | undefined;
  /** Optional output size limit in bytes */
  readonly maxBuffer?: number | undefined;
  /** Allowed arguments (allowlist mode) */
  readonly allowedArgs?: readonly string[] | undefined;
  /** Blocked arguments (blocklist mode) */
  readonly blockedArgs?: readonly string[] | undefined;
  /** Working directory for command execution */
  readonly cwd?: string | undefined;
  /** Environment variables for command */
  readonly env?: Record<string, string> | undefined;
  /** Whether command accepts stdin */
  readonly stdin?: boolean | undefined;
  /** Optional description for introspection */
  readonly description?: string | undefined;
}

/** Command execution result. */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Exec extension configuration. */
export interface ExecExtensionConfig {
  /** Command definitions keyed by command name */
  readonly commands: Record<string, CommandConfig>;
  /** Global timeout in milliseconds (default: 30000 = 30s) */
  readonly timeout?: number | undefined;
  /** Global output size limit in bytes (default: 1048576 = 1MB) */
  readonly maxOutputSize?: number | undefined;
  /** Inherit parent process environment (default: false) */
  readonly inheritEnv?: boolean | undefined;
}
