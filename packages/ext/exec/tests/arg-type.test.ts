/**
 * Tests that non-scalar command arguments are rejected before spawning.
 */

import { describe, it, expect, vi } from 'vitest';
import { createExecExtension } from '../src/factory.js';
import { runCommand } from '../src/runner.js';
import {
  getCallable,
  invalidStatus,
  makeFactoryCtx,
  makeRuntimeCtx,
} from './_setup.js';

vi.mock('../src/runner.js', () => ({
  PROVIDER: 'exec',
  runCommand: vi.fn(),
}));

describe('argument type validation', () => {
  it('rejects a non-scalar arg with invalid_arg_type before running the command', async () => {
    const ext = createExecExtension(
      { commands: { echo: { binary: 'echo' } } },
      makeFactoryCtx()
    );

    const result = await getCallable(ext, 'echo').fn(
      { args: ['ok', { nested: true }] },
      makeRuntimeCtx()
    );

    const status = invalidStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.raw['kind']).toBe('invalid_arg_type');
    expect(runCommand).not.toHaveBeenCalled();
  });
});
