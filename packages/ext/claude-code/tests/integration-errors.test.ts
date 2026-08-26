/**
 * Integration tests for Claude Code extension error contracts (rill 0.19).
 *
 * Validation, spawn, and exit-failure paths now produce invalid `RillValue`s
 * carrying generic atoms (`#INVALID_INPUT`, `#UNAVAILABLE`, `#FORBIDDEN`,
 * `#TIMEOUT`) via `ctx.invalidate`. Factory-time binary validation throws
 * `RuntimeError('RILL-R001', ...)`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { SpawnError } from '../src/errors.js';
import {
  expectInvalidThrow,
  makeFactoryCtx,
  extValue,
  type StreamStep,
} from './_helpers.js';
import type { IPty } from 'node-pty';
import {
  createRuntimeContext,
  RuntimeError,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';

// ============================================================
// MOCKS
// ============================================================

vi.mock('which', () => ({
  default: { sync: vi.fn() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('../src/process.js');
vi.mock('../src/stream-parser.js');
vi.mock('../src/result.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// STREAM HELPERS
// ============================================================

async function resolveStream(stream: unknown): Promise<RillValue> {
  return (
    stream as { __rill_stream_resolve: () => Promise<RillValue> }
  ).__rill_stream_resolve();
}

async function collectChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  let current: StreamStep = stream as StreamStep;
  while (!current.done) {
    current = (await current.next.fn({}, null)) as StreamStep;
    if (!current.done && current.value !== undefined) {
      chunks.push(current.value as string);
    }
  }
  return chunks;
}

// ============================================================
// EC-1: Invalid binaryPath at factory creation
// ============================================================

describe('EC-1: Invalid binaryPath at factory creation', () => {
  it('throws RuntimeError(RILL-R001) when which.sync fails', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    let caught: unknown;
    try {
      createClaudeCodeExtension(
        { binaryPath: '/invalid/claude' },
        makeFactoryCtx()
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    expect((caught as RuntimeError).message).toContain(
      'claude binary not found'
    );
  });

  it('throws for binary not in PATH', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension(
        { binaryPath: 'nonexistent-binary' },
        makeFactoryCtx()
      )
    ).toThrow('claude binary not found');
  });
});

// ============================================================
// EC-2: Invalid defaultTimeout
// ============================================================

describe('EC-2: Invalid defaultTimeout', () => {
  beforeEach(async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');
  });

  it('throws Error for negative timeout', () => {
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: -1000 }, makeFactoryCtx())
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });

  it('throws Error for zero timeout', () => {
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 0 }, makeFactoryCtx())
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });

  it('throws Error for non-integer timeout', () => {
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 1500.5 }, makeFactoryCtx())
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });

  it('throws Error for timeout exceeding max (3600000)', () => {
    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 3600001 }, makeFactoryCtx())
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });
});

// ============================================================
// EC-3: Empty text to prompt
// ============================================================

describe('EC-3, AC-11: Empty text to prompt', () => {
  beforeEach(async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');
  });

  it('invalidates with #INVALID_INPUT for empty prompt text', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: '', options: {} }, ctx),
      'INVALID_INPUT',
      'prompt text cannot be empty'
    );
  });

  it('invalidates with #INVALID_INPUT for whitespace-only text', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: '   ', options: {} }, ctx),
      'INVALID_INPUT',
      'prompt text cannot be empty'
    );
    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: '\t\n  ', options: {} }, ctx),
      'INVALID_INPUT',
      'prompt text cannot be empty'
    );
  });
});

// ============================================================
// EC-4: Binary not found at spawn (ENOENT)
// ============================================================

describe('EC-4, AC-6: Binary not found at spawn (ENOENT)', () => {
  it('invalidates with #UNAVAILABLE when spawnClaudeCli throws SpawnError(binary_missing)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError('binary_missing', 'claude binary not found', {
        binary_path: 'claude',
      });
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx),
      'UNAVAILABLE',
      'claude binary not found'
    );
  });
});

// ============================================================
// EC-5: Permission denied (EACCES)
// ============================================================

describe('EC-5, AC-7: Permission denied (EACCES)', () => {
  it('invalidates with #FORBIDDEN when spawnClaudeCli throws SpawnError(binary_eacces)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError('binary_eacces', 'Permission denied: claude', {
        binary_path: '/usr/bin/claude',
      });
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx),
      'FORBIDDEN',
      'Permission denied'
    );
  });
});

// ============================================================
// EC-6: Generic spawn failure
// ============================================================

describe('EC-6: Generic spawn failure', () => {
  it('invalidates with #UNAVAILABLE when spawnClaudeCli throws SpawnError(spawn_failed)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError(
        'spawn_failed',
        'Failed to spawn claude binary: Unknown spawn error',
        {
          binary_path: 'claude',
        }
      );
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx),
      'UNAVAILABLE',
      'Failed to spawn claude binary'
    );
  });
});

// ============================================================
// EC-8: Timeout exceeded (cli_timeout via exitCode rejection)
// ============================================================

describe('EC-8, AC-8: Timeout exceeded', () => {
  it('stream resolve() returns invalid value with #TIMEOUT', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('cli_timeout', 'Claude CLI timeout after 5000ms', {
          timeout_ms: 5000,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx);
    await collectChunks(stream);
    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('TIMEOUT');
  });
});

// ============================================================
// EC-9: Non-zero exit code
// ============================================================

describe('EC-9, AC-9: Non-zero exit code', () => {
  it('yields error chunk and resolve() returns invalid with #UNAVAILABLE', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('exit_nonzero', 'Claude CLI exited with code 1', {
          exit_code: 1,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx);
    const chunks = await collectChunks(stream);

    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code 1');

    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('UNAVAILABLE');
  });

  it('exit code 127 produces invalid #UNAVAILABLE result', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 127,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('exit_nonzero', 'Claude CLI exited with code 127', {
          exit_code: 127,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).prompt.fn({ text: 'test', options: {} }, ctx);
    const chunks = await collectChunks(stream);
    expect(chunks.some((c) => c.includes('127'))).toBe(true);

    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('UNAVAILABLE');
  });
});

// ============================================================
// EC-10: Empty skill name
// ============================================================

describe('EC-10: Empty skill name', () => {
  beforeEach(async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');
  });

  it('invalidates with #INVALID_INPUT for empty skill name', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).skill.fn({ name: '', args: {} }, ctx),
      'INVALID_INPUT',
      'skill name cannot be empty'
    );
  });

  it('invalidates with #INVALID_INPUT for whitespace-only skill name', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).skill.fn({ name: '   ', args: {} }, ctx),
      'INVALID_INPUT',
      'skill name cannot be empty'
    );
  });
});

// ============================================================
// EC-11: Invalid skill name (non-zero exit)
// ============================================================

describe('EC-11: Invalid skill name (non-zero exit)', () => {
  it('yields error chunk and resolve() returns invalid #UNAVAILABLE', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 2,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('exit_nonzero', 'Claude CLI exited with code 2', {
          exit_code: 2,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).skill.fn(
      { name: 'invalid-skill', args: {} },
      ctx
    );
    const chunks = await collectChunks(stream);

    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code');

    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('UNAVAILABLE');
  });
});

// ============================================================
// EC-12: Skill spawn / timeout
// ============================================================

describe('EC-12: Skill spawn/parse/timeout errors', () => {
  it('invalidates with #UNAVAILABLE for spawn error', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError(
        'spawn_failed',
        'Failed to spawn claude binary: test error',
        {
          binary_path: 'claude',
        }
      );
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).skill.fn({ name: 'test-skill', args: {} }, ctx),
      'UNAVAILABLE',
      'Failed to spawn claude binary'
    );
  });

  it('resolve() returns #TIMEOUT on cli_timeout for skill', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('cli_timeout', 'Claude CLI timeout after 10000ms', {
          timeout_ms: 10000,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).skill.fn(
      { name: 'test-skill', args: {} },
      ctx
    );
    await collectChunks(stream);
    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('TIMEOUT');
  });
});

// ============================================================
// EC-13: Empty command name
// ============================================================

describe('EC-13: Empty command name', () => {
  beforeEach(async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');
  });

  it('invalidates with #INVALID_INPUT for empty command name', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).command.fn({ name: '', args: {} }, ctx),
      'INVALID_INPUT',
      'command name cannot be empty'
    );
  });

  it('invalidates with #INVALID_INPUT for whitespace-only command name', () => {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).command.fn({ name: '\t\n', args: {} }, ctx),
      'INVALID_INPUT',
      'command name cannot be empty'
    );
  });
});

// ============================================================
// EC-14: Invalid command (non-zero exit)
// ============================================================

describe('EC-14: Invalid command (non-zero exit)', () => {
  it('yields error chunk and resolve() returns invalid #UNAVAILABLE', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 3,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('exit_nonzero', 'Claude CLI exited with code 3', {
          exit_code: 3,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).command.fn(
      { name: 'invalid-command', args: {} },
      ctx
    );
    const chunks = await collectChunks(stream);
    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code');

    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('UNAVAILABLE');
  });
});

// ============================================================
// EC-15: Command spawn / timeout / EACCES
// ============================================================

describe('EC-15: Command spawn/parse/timeout errors', () => {
  it('invalidates with #UNAVAILABLE for spawn error', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError('binary_missing', 'claude binary not found', {
        binary_path: 'claude',
      });
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).command.fn({ name: 'test-command', args: {} }, ctx),
      'UNAVAILABLE',
      'claude binary not found'
    );
  });

  it('resolve() returns #TIMEOUT on cli_timeout for command', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: {
        prompt: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 0,
      },
      cost: 0,
      exit_code: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.reject(
        new SpawnError('cli_timeout', 'Claude CLI timeout after 15000ms', {
          timeout_ms: 15000,
        })
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).command.fn(
      { name: 'test-command', args: {} },
      ctx
    );
    await collectChunks(stream);
    const result = await resolveStream(stream);
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code.name).toBe('TIMEOUT');
  });

  it('invalidates with #FORBIDDEN for permission denied (binary_eacces)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new SpawnError('binary_eacces', 'Permission denied: claude', {
        binary_path: '/usr/bin/claude',
      });
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    expectInvalidThrow(
      () => extValue(ext).command.fn({ name: 'test-command', args: {} }, ctx),
      'FORBIDDEN',
      'Permission denied'
    );
  });
});
