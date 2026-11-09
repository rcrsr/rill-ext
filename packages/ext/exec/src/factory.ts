/**
 * Factory function for creating exec extension.
 *
 * @module
 */

import {
  getStatus,
  isInvalid,
  structureToTypeValue,
  toCallable,
  type CallableFn,
  type ExtensionFactoryCtx,
  type ExtensionFactoryResult,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';
import type {
  CommandConfig,
  CommandResult,
  ExecExtensionConfig,
} from './types.js';
import {
  createDisposedHalt,
  throwIfCancelledByDispose,
} from '@rcrsr/rill-ext-lifecycle-shared';
import { PROVIDER, runCommand } from './runner.js';

/**
 * Creates an exec extension with sandboxed command execution.
 *
 * Generates one host function per declared command, plus a commands() introspection function.
 */
export function createExecExtension(
  config: ExecExtensionConfig,
  ctx: ExtensionFactoryCtx
): ExtensionFactoryResult {
  const globalTimeout = config.timeout ?? 30000;
  const globalMaxOutputSize = config.maxOutputSize ?? 1048576;
  const inheritEnv = config.inheritEnv ?? false;

  const abortControllers: AbortController[] = [];
  let disposed = false;

  const getTimeout = (cmd: CommandConfig): number =>
    cmd.timeout ?? globalTimeout;
  const getMaxBuffer = (cmd: CommandConfig): number =>
    cmd.maxBuffer ?? globalMaxOutputSize;

  const getEnv = (cmd: CommandConfig): Record<string, string> => {
    const baseEnv: Record<string, string> = {};
    if (inheritEnv) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) baseEnv[key] = value;
      }
    } else {
      // Isolation: withhold parent secrets (API keys, tokens) but keep PATH so
      // bare-name binaries still resolve through execFile. Returning undefined
      // here would make execFile inherit the full process.env instead.
      const path = process.env['PATH'];
      if (path !== undefined) baseEnv['PATH'] = path;
      const pathExt = process.env['PATHEXT'];
      if (pathExt !== undefined) baseEnv['PATHEXT'] = pathExt;
    }
    if (cmd.env) Object.assign(baseEnv, cmd.env);
    return baseEnv;
  };

  // ----------------------------------------------------------
  // Generate command functions
  // ----------------------------------------------------------

  const functions: Record<string, RillFunction> = {};

  for (const [commandName, commandConfig] of Object.entries(config.commands)) {
    const commandFn: CallableFn = async (args, runCtxLike) => {
      const runCtx = runCtxLike;
      const argsParam = (args['args'] as RillValue[] | undefined) ?? [];
      const stdinParam = args['stdin'] as string | undefined;
      const stringArgs: string[] = [];
      for (const arg of argsParam) {
        if (
          typeof arg !== 'string' &&
          typeof arg !== 'number' &&
          typeof arg !== 'boolean'
        ) {
          return runCtx.invalidate(
            new Error(
              `argument for command "${commandName}" must be a string, number, or boolean`
            ),
            {
              code: 'INVALID_INPUT',
              provider: PROVIDER,
              raw: { kind: 'invalid_arg_type', commandName },
            }
          );
        }
        stringArgs.push(String(arg));
      }

      const controller = new AbortController();
      abortControllers.push(controller);

      // Compose factory-scope cancellation with per-call abort so script-level
      // cancel kills children spawned by this call.
      const composedSignal = AbortSignal.any([ctx.signal, controller.signal]);

      try {
        const effectiveConfig: CommandConfig = {
          ...commandConfig,
          timeout: getTimeout(commandConfig),
          maxBuffer: getMaxBuffer(commandConfig),
          env: getEnv(commandConfig),
        };

        const result = await runCommand(
          commandName,
          effectiveConfig,
          stringArgs,
          stdinParam,
          composedSignal,
          runCtx
        );

        if (isInvalid(result as RillValue)) {
          // dispose() cancelled this command: runCommand maps the abort to an
          // 'aborted' invalid, which is remapped to a thrown #DISPOSED. A
          // genuine failure that resolved while dispose ran keeps its own atom.
          if (
            controller.signal.aborted &&
            getStatus(result as RillValue).raw['kind'] === 'aborted'
          ) {
            throwIfCancelledByDispose(
              runCtx,
              PROVIDER,
              controller.signal.reason,
              disposed
            );
          }
          return result as RillValue;
        }

        const cmdResult = result as CommandResult;
        return {
          stdout: cmdResult.stdout,
          stderr: cmdResult.stderr,
          exit_code: cmdResult.exitCode,
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
      // Per-command callable returns the captured stdout / stderr / exit_code
      // dict per §EXT.8. See lines 95-99 above for the dict literal.
      returnType: structureToTypeValue({
        kind: 'dict',
        fields: {
          stdout: { type: { kind: 'string' } },
          stderr: { type: { kind: 'string' } },
          exit_code: { type: { kind: 'number' } },
        },
      }),
    };
  }

  // ----------------------------------------------------------
  // Introspection
  // ----------------------------------------------------------

  const commands: CallableFn = (): Promise<RillValue> => {
    const result: RillValue[] = [];
    for (const [name, cmd] of Object.entries(config.commands)) {
      result.push({ name, description: cmd.description ?? '' });
    }
    return Promise.resolve(result as unknown as RillValue);
  };

  functions['commands'] = {
    params: [],
    fn: commands,
    annotations: { description: 'List all configured commands' },
    returnType: structureToTypeValue({
      kind: 'list',
      element: {
        kind: 'dict',
        fields: {
          name: { type: { kind: 'string' } },
          description: { type: { kind: 'string' } },
        },
      },
    }),
  };

  // ----------------------------------------------------------
  // Dispose
  // ----------------------------------------------------------

  const dispose = (): Promise<void> => {
    disposed = true;
    for (const controller of abortControllers) {
      controller.abort();
    }
    abortControllers.length = 0;
    return Promise.resolve();
  };

  // ----------------------------------------------------------
  // Build callable dict
  // ----------------------------------------------------------

  const callableDict: Record<string, RillValue> = {};
  for (const [name, def] of Object.entries(functions)) {
    const guarded: RillFunction = {
      ...def,
      fn: (args, runCtx, location) => {
        if (disposed) throw createDisposedHalt(runCtx, PROVIDER);
        return def.fn(args, runCtx, location);
      },
    };
    callableDict[name] = toCallable(guarded);
  }

  return {
    value: callableDict as unknown as RillValue,
    dispose,
  } satisfies ExtensionFactoryResult;
}
