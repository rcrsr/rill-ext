/**
 * Tests for the in-flight dispose remap in the exec factory.
 *
 * dispose() aborts every active controller, so any command still running at
 * dispose time has an aborted signal. The runner is mocked so a test can
 * resolve a command with a chosen failure after dispose() runs.
 */

import { describe, it, expect, vi } from 'vitest';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { createExecExtension } from '../src/factory.js';
import {
  getCallable,
  invalidStatus,
  makeFactoryCtx,
  makeRuntimeCtx,
} from './_setup.js';

const resolvers: Array<(value: RillValue) => void> = [];

vi.mock('../src/runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/runner.js')>();
  return {
    ...actual,
    runCommand: (): Promise<RillValue> =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  };
});

function startCommand(): {
  ext: ReturnType<typeof createExecExtension>;
  result: Promise<RillValue>;
  ctx: RuntimeContext;
} {
  const ext = createExecExtension(
    { commands: { tool: { binary: 'tool' } } },
    makeFactoryCtx()
  );
  const ctx = makeRuntimeCtx();
  const result = getCallable(ext, 'tool').fn(
    { args: [] },
    ctx
  ) as Promise<RillValue>;
  return { ext, result, ctx };
}

/** Resolve the oldest mocked runCommand call with `value`. */
function settle(value: RillValue): void {
  const resolve = resolvers.shift();
  if (resolve === undefined) throw new Error('no pending command');
  resolve(value);
}

describe('exec in-flight dispose remap', () => {
  it('maps an abort caused by dispose to DISPOSED', async () => {
    const { ext, result, ctx } = startCommand();
    await ext.dispose!();

    settle(
      ctx.invalidate(new Error('command "tool" aborted'), {
        code: 'TIMEOUT',
        provider: 'exec',
        raw: { kind: 'aborted', commandName: 'tool' },
      })
    );

    const status = invalidStatus(await result);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('keeps the original atom when a command fails while dispose runs', async () => {
    const { ext, result, ctx } = startCommand();
    await ext.dispose!();

    settle(
      ctx.invalidate(new Error('binary not found: tool'), {
        code: 'INVALID_INPUT',
        provider: 'exec',
        raw: { kind: 'binary_not_found', commandName: 'tool' },
      })
    );

    const status = invalidStatus(await result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.raw['kind']).toBe('binary_not_found');
  });
});
