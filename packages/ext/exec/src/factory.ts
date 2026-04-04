/**
 * Factory function for creating exec extension.
 *
 * @module
 */

import {
  structureToTypeValue,
  toCallable,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import type { CommandConfig, CommandResult, ExecExtensionConfig } from './types.js';
import { runCommand } from './runner.js';

/**
 * Creates an exec extension with sandboxed command execution.
 *
 * Generates one host function per declared command, plus a commands() introspection function.
 */
export function createExecExtension(
  config: ExecExtensionConfig,
): ExtensionFactoryResult {
  const globalTimeout = config.timeout ?? 30000;
  const globalMaxOutputSize = config.maxOutputSize ?? 1048576;
  const inheritEnv = config.inheritEnv ?? false;

  const abortControllers: AbortController[] = [];

  const getTimeout = (cmd: CommandConfig): number => cmd.timeout ?? globalTimeout;
  const getMaxBuffer = (cmd: CommandConfig): number => cmd.maxBuffer ?? globalMaxOutputSize;

  const getEnv = (cmd: CommandConfig): Record<string, string> | undefined => {
    if (!inheritEnv && !cmd.env) return undefined;

    const baseEnv: Record<string, string> = {};
    if (inheritEnv) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) baseEnv[key] = value;
      }
    }
    if (cmd.env) Object.assign(baseEnv, cmd.env);
    return baseEnv;
  };

  // ----------------------------------------------------------
  // Generate command functions
  // ----------------------------------------------------------

  const functions: Record<string, RillFunction> = {};

  for (const [commandName, commandConfig] of Object.entries(config.commands)) {
    const commandFn = async (
      args: Record<string, RillValue>,
    ): Promise<RillValue> => {
      const argsParam = (args['args'] as RillValue[] | undefined) ?? [];
      const stdinParam = args['stdin'] as string | undefined;
      const stringArgs = argsParam.map((arg) => String(arg));

      const controller = new AbortController();
      abortControllers.push(controller);

      try {
        const effectiveConfig: CommandConfig = {
          ...commandConfig,
          timeout: getTimeout(commandConfig),
          maxBuffer: getMaxBuffer(commandConfig),
          env: getEnv(commandConfig),
        };

        const result: CommandResult = await runCommand(
          commandName,
          effectiveConfig,
          stringArgs,
          stdinParam,
          controller.signal,
        );

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } finally {
        const index = abortControllers.indexOf(controller);
        if (index !== -1) abortControllers.splice(index, 1);
      }
    };

    functions[commandName] = {
      params: [
        {
          name: 'args',
          type: { kind: 'list' },
          defaultValue: [],
          annotations: { description: 'Command arguments' },
        },
        {
          name: 'stdin',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: { description: 'Standard input data' },
        },
      ],
      fn: commandFn,
      annotations: {
        description:
          commandConfig.description ?? `Execute ${commandName} command`,
      },
      returnType: structureToTypeValue({ kind: 'dict' }),
    };
  }

  // ----------------------------------------------------------
  // Introspection
  // ----------------------------------------------------------

  const commands = async (): Promise<RillValue[]> => {
    const result: RillValue[] = [];
    for (const [name, cmd] of Object.entries(config.commands)) {
      result.push({ name, description: cmd.description ?? '' });
    }
    return result;
  };

  functions['commands'] = {
    params: [],
    fn: commands,
    annotations: { description: 'List all configured commands' },
    returnType: structureToTypeValue({ kind: 'list' }),
  };

  // ----------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------

  const dispose = async (): Promise<void> => {
    for (const controller of abortControllers) {
      controller.abort();
    }
    abortControllers.length = 0;
  };

  // ----------------------------------------------------------
  // Build callable dict
  // ----------------------------------------------------------

  const callableDict: Record<string, RillValue> = {};
  for (const [name, def] of Object.entries(functions)) {
    callableDict[name] = toCallable(def);
  }

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
