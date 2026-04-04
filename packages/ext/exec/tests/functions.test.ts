/**
 * Tests for exec extension functions.
 *
 * Verifies command execution, argument validation, security controls, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createExecExtension } from '../src/factory.js';
import { runCommand } from '../src/runner.js';
import type { CommandConfig } from '../src/types.js';

describe('command execution', () => {
  it('executes command and returns stdout, stderr, exitCode', async () => {
    const ext = createExecExtension({
      commands: { echo: { binary: 'echo' } },
    });

    const result = await ext.value.echo.fn({ args: ['hello', 'world'] });

    expect(result).toMatchObject({
      stdout: expect.stringContaining('hello world'),
      stderr: '',
      exitCode: 0,
    });
  });

  it('handles empty args (defaults to empty list)', async () => {
    const ext = createExecExtension({
      commands: { pwd: { binary: 'pwd' } },
    });

    const result = await ext.value.pwd.fn({});

    expect(result).toMatchObject({
      stdout: expect.any(String),
      stderr: '',
      exitCode: 0,
    });
  });

  it('converts args to strings', async () => {
    const ext = createExecExtension({
      commands: { echo: { binary: 'echo' } },
    });

    const result = await ext.value.echo.fn({ args: [123, 456, true] });
    expect(result).toMatchObject({
      stdout: expect.stringContaining('123'),
      exitCode: 0,
    });
  });

  it('executes in specified cwd', async () => {
    const ext = createExecExtension({
      commands: { pwd: { binary: 'pwd', cwd: '/tmp' } },
    });

    const result = await ext.value.pwd.fn({ args: [] });
    expect(result.stdout.trim()).toBe('/tmp');
  });

  it('merges command env with inherited env', async () => {
    const ext = createExecExtension({
      inheritEnv: true,
      commands: {
        printenv: {
          binary: 'printenv',
          env: { CUSTOM_VAR: 'test_value' },
        },
      },
    });

    const result = await ext.value.printenv.fn({ args: ['CUSTOM_VAR'] });
    expect(result.stdout.trim()).toBe('test_value');
  });
});

describe('runner: argument validation', () => {
  it('allows arguments in allowlist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      allowedArgs: ['hello', 'world'],
    };

    const result = await runCommand('echo', config, ['hello', 'world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
  });

  it('throws when argument not in allowlist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      allowedArgs: ['hello', 'world'],
    };

    await expect(runCommand('echo', config, ['forbidden'])).rejects.toMatchObject({
      errorId: 'RILL-R004',
      message: expect.stringContaining('not permitted'),
      context: expect.objectContaining({ arg: 'forbidden' }),
    });
  });

  it('allows arguments not in blocklist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      blockedArgs: ['--danger'],
    };

    const result = await runCommand('echo', config, ['hello']);
    expect(result.exitCode).toBe(0);
  });

  it('throws when argument in blocklist', async () => {
    const config: CommandConfig = {
      binary: 'echo',
      blockedArgs: ['--danger'],
    };

    await expect(runCommand('echo', config, ['--danger'])).rejects.toMatchObject({
      errorId: 'RILL-R004',
      message: expect.stringContaining('is blocked'),
    });
  });
});

describe('runner: stdin validation', () => {
  it('throws when stdin provided but not supported', async () => {
    const config: CommandConfig = { binary: 'echo' };

    await expect(
      runCommand('echo', config, ['test'], 'stdin data'),
    ).rejects.toMatchObject({
      errorId: 'RILL-R004',
      message: expect.stringContaining('does not support stdin'),
    });
  });
});

describe('runner: error handling', () => {
  it('returns non-zero exit code without error', async () => {
    const result = await runCommand('sh', { binary: 'sh' }, ['-c', 'exit 42']);
    expect(result.exitCode).toBe(42);
  });

  it('captures stderr output', async () => {
    const result = await runCommand('sh', { binary: 'sh' }, ['-c', 'echo error >&2; exit 1']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.trim()).toBe('error');
  });

  it('throws when binary not found', async () => {
    await expect(
      runCommand('fake', { binary: '/nonexistent/binary' }, []),
    ).rejects.toMatchObject({
      errorId: 'RILL-R004',
      message: expect.stringContaining('binary not found'),
    });
  });

  it('throws when command times out', async () => {
    await expect(
      runCommand('sleep', { binary: 'sleep', timeout: 100 }, ['10']),
    ).rejects.toMatchObject({
      errorId: 'RILL-R012',
      message: expect.stringMatching(/timed out.*100ms/),
    });
  });

  it('throws when output exceeds maxBuffer', async () => {
    await expect(
      runCommand('sh', { binary: 'sh', maxBuffer: 10 }, ['-c', `echo ${'a'.repeat(100)}`]),
    ).rejects.toMatchObject({
      errorId: 'RILL-R004',
      message: expect.stringContaining('exceeds size limit'),
    });
  });
});

describe('runner: shell injection prevention', () => {
  it('does not interpret shell metacharacters', async () => {
    const result = await runCommand('echo', { binary: 'echo' }, ['$HOME', '&&', 'ls']);
    expect(result.stdout.trim()).toBe('$HOME && ls');
  });

  it('does not execute command injection via backticks', async () => {
    const result = await runCommand('echo', { binary: 'echo' }, ['`whoami`']);
    expect(result.stdout.trim()).toBe('`whoami`');
  });

  it('does not execute pipe attempts', async () => {
    const result = await runCommand('echo', { binary: 'echo' }, ['test', '|', 'grep', 'test']);
    expect(result.stdout.trim()).toBe('test | grep test');
  });
});
