/**
 * Tests for exec extension functions.
 *
 * Verifies command execution, argument validation, security controls, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createExecExtension } from '../src/factory.js';
import { runCommand } from '../src/runner.js';
import type { CommandConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

describe('command execution', () => {
  it('executes command and returns stdout, stderr, exit_code', async () => {
    const ext = createExecExtension(
      {
        commands: { echo: { binary: 'echo' } },
      },
      makeFactoryCtx()
    );

    const result = await ext.value.echo.fn(
      { args: ['hello', 'world'] },
      makeRuntimeCtx()
    );

    expect(result).toMatchObject({
      stdout: expect.stringContaining('hello world'),
      stderr: '',
      exit_code: 0,
    });
  });

  it('handles empty args (defaults to empty list)', async () => {
    const ext = createExecExtension(
      {
        commands: { pwd: { binary: 'pwd' } },
      },
      makeFactoryCtx()
    );

    const result = await ext.value.pwd.fn({}, makeRuntimeCtx());

    expect(result).toMatchObject({
      stdout: expect.any(String),
      stderr: '',
      exit_code: 0,
    });
  });

  it('converts args to strings', async () => {
    const ext = createExecExtension(
      {
        commands: { echo: { binary: 'echo' } },
      },
      makeFactoryCtx()
    );

    const result = await ext.value.echo.fn(
      { args: [123, 456, true] },
      makeRuntimeCtx()
    );
    expect(result).toMatchObject({
      stdout: expect.stringContaining('123'),
      exit_code: 0,
    });
  });

  it('executes in specified cwd', async () => {
    const ext = createExecExtension(
      {
        commands: { pwd: { binary: 'pwd', cwd: '/tmp' } },
      },
      makeFactoryCtx()
    );

    const result = await ext.value.pwd.fn({ args: [] }, makeRuntimeCtx());
    expect((result as { stdout: string }).stdout.trim()).toBe('/tmp');
  });

  it('merges command env with inherited env', async () => {
    const ext = createExecExtension(
      {
        inheritEnv: true,
        commands: {
          printenv: {
            binary: 'printenv',
            env: { CUSTOM_VAR: 'test_value' },
          },
        },
      },
      makeFactoryCtx()
    );

    const result = await ext.value.printenv.fn(
      { args: ['CUSTOM_VAR'] },
      makeRuntimeCtx()
    );
    expect((result as { stdout: string }).stdout.trim()).toBe('test_value');
  });
});

describe('runner: argument validation', () => {
  it('allows arguments in allowlist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      allowedArgs: ['hello', 'world'],
    };

    const result = await runCommand(
      'echo',
      config,
      ['hello', 'world'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { exitCode: number }).exitCode).toBe(0);
    expect((result as { stdout: string }).stdout.trim()).toBe('hello world');
  });

  it('returns invalid value when argument not in allowlist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      allowedArgs: ['hello', 'world'],
    };

    const result = await runCommand(
      'echo',
      config,
      ['forbidden'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/not permitted/);
  });

  it('allows arguments not in blocklist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      blockedArgs: ['--danger'],
    };

    const result = await runCommand(
      'echo',
      config,
      ['hello'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { exitCode: number }).exitCode).toBe(0);
  });

  it('returns invalid value when argument in blocklist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      blockedArgs: ['--danger'],
    };

    const result = await runCommand(
      'echo',
      config,
      ['--danger'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/is blocked/);
  });
});

describe('runner: stdin validation', () => {
  it('returns invalid value when stdin provided but not supported', async () => {
    const config: CommandConfig = { binary: 'echo' };

    const result = await runCommand(
      'echo',
      config,
      ['test'],
      'stdin data',
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/does not support stdin/);
  });
});

describe('runner: error handling', () => {
  it('returns non-zero exit code without error', async () => {
    const result = await runCommand(
      'sh',
      { binary: 'sh' },
      ['-c', 'exit 42'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { exitCode: number }).exitCode).toBe(42);
  });

  it('captures stderr output', async () => {
    const result = await runCommand(
      'sh',
      { binary: 'sh' },
      ['-c', 'echo error >&2; exit 1'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { exitCode: number }).exitCode).toBe(1);
    expect((result as { stderr: string }).stderr.trim()).toBe('error');
  });

  it('returns invalid value when binary not found', async () => {
    const result = await runCommand(
      'fake',
      { binary: '/nonexistent/binary' },
      [],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/binary not found/);
  });

  it('returns invalid value when command times out', async () => {
    const result = await runCommand(
      'sleep',
      { binary: 'sleep', timeout: 100 },
      ['10'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('TIMEOUT');
    expect(status.message).toMatch(/timed out.*100ms/);
  });

  it('returns invalid value when output exceeds maxBuffer', async () => {
    const result = await runCommand(
      'sh',
      { binary: 'sh', maxBuffer: 10 },
      ['-c', `echo ${'a'.repeat(100)}`],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/exceeds size limit/);
  });
});

describe('runner: shell injection prevention', () => {
  it('does not interpret shell metacharacters', async () => {
    const result = await runCommand(
      'echo',
      { binary: 'echo' },
      ['$HOME', '&&', 'ls'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { stdout: string }).stdout.trim()).toBe('$HOME && ls');
  });

  it('does not execute command injection via backticks', async () => {
    const result = await runCommand(
      'echo',
      { binary: 'echo' },
      ['`whoami`'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { stdout: string }).stdout.trim()).toBe('`whoami`');
  });

  it('does not execute pipe attempts', async () => {
    const result = await runCommand(
      'echo',
      { binary: 'echo' },
      ['test', '|', 'grep', 'test'],
      undefined,
      undefined,
      makeRuntimeCtx()
    );
    expect((result as { stdout: string }).stdout.trim()).toBe(
      'test | grep test'
    );
  });
});
