/**
 * Integration tests for Claude Code extension error contracts.
 * Tests error handling across factory, prompt, skill, command, and dispose.
 *
 * Covers: EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-8, EC-9, EC-10, EC-11, EC-12, EC-13, EC-14, EC-15, EC-16
 * Acceptance: AC-6, AC-7, AC-8, AC-9, AC-11
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { createRuntimeContext, RuntimeError } from '@rcrsr/rill';

// ============================================================
// MOCKS
// ============================================================

// Mock which module for binary validation
vi.mock('which', () => ({
  default: {
    sync: vi.fn(),
  },
}));

// Mock node-pty to avoid native module
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock process module
vi.mock('../src/process.js');

// Mock stream parser
vi.mock('../src/stream-parser.js');

// Mock result extractor
vi.mock('../src/result.js');

// ============================================================
// SETUP
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// STREAM HELPERS
// ============================================================

/**
 * Resolve a RillStream by calling its hidden __rill_stream_resolve property.
 */
async function resolveStream(stream: unknown): Promise<Record<string, unknown>> {
  return (stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }).__rill_stream_resolve();
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected string chunks.
 */
async function collectChunks(stream: unknown): Promise<string[]> {
  const chunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = stream;
  while (!current.done) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    current = await (current.next as any).fn({}, null);
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
  it('throws RuntimeError RILL-R004 "claude binary not found" when which.sync fails', async () => {
    const which = await import('which');

    // Mock which.sync to throw (binary not in PATH)
    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: '/invalid/claude' })
    ).toThrow('claude binary not found');
  });

  it('throws for binary not in PATH', async () => {
    const which = await import('which');

    vi.mocked(which.default.sync).mockImplementation(() => {
      throw new Error('not found');
    });

    expect(() =>
      createClaudeCodeExtension({ binaryPath: 'nonexistent-binary' })
    ).toThrow('claude binary not found');
  });
});

// ============================================================
// EC-2: Invalid defaultTimeout
// ============================================================

describe('EC-2: Invalid defaultTimeout', () => {
  it('throws Error for negative timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: -1000 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for zero timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 0 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for non-integer timeout', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() => createClaudeCodeExtension({ defaultTimeout: 1500.5 })).toThrow(
      'Invalid timeout: must be positive integer, max 3600000'
    );
  });

  it('throws Error for timeout exceeding max (3600000)', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    expect(() =>
      createClaudeCodeExtension({ defaultTimeout: 3600001 })
    ).toThrow('Invalid timeout: must be positive integer, max 3600000');
  });
});

// ============================================================
// EC-3: Empty text to prompt
// ============================================================

describe('EC-3, AC-11: Empty text to prompt', () => {
  it('throws RuntimeError RILL-R004 "prompt text cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Validation throws synchronously before stream creation (AC-10)
    expect(() => (ext.value as any).prompt.fn({ text: '', options: {} }, ctx)).toThrow(RuntimeError);

    expect(() => (ext.value as any).prompt.fn({ text: '', options: {} }, ctx)).toThrow(
      'prompt text cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only text', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).prompt.fn({ text: '   ', options: {} }, ctx)).toThrow(
      'prompt text cannot be empty'
    );

    expect(() => (ext.value as any).prompt.fn({ text: '\t\n  ', options: {} }, ctx)).toThrow(
      'prompt text cannot be empty'
    );
  });
});

// ============================================================
// EC-4: Binary not found at spawn (ENOENT)
// ============================================================

describe('EC-4, AC-6: Binary not found at spawn (ENOENT)', () => {
  it('throws RuntimeError RILL-R004 "claude binary not found"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw ENOENT error synchronously
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'claude binary not found',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // spawnClaudeCli throws synchronously → fn() throws before creating stream
    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      RuntimeError
    );

    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      /claude binary not found/
    );
  });
});

// ============================================================
// EC-5: Permission denied (EACCES)
// ============================================================

describe('EC-5, AC-7: Permission denied (EACCES)', () => {
  it('throws RuntimeError RILL-R004 "Permission denied: claude"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw EACCES error synchronously
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Permission denied: claude',
        undefined,
        { binaryPath: '/usr/bin/claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      RuntimeError
    );

    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      /Permission denied: claude/
    );
  });
});

// ============================================================
// EC-6: Generic spawn failure
// ============================================================

describe('EC-6: Generic spawn failure', () => {
  it('throws RuntimeError RILL-R004 "Failed to spawn claude binary: {error}"', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock spawn to throw generic error synchronously
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Failed to spawn claude binary: Unknown spawn error',
        undefined,
        { binaryPath: 'claude', originalError: 'Unknown spawn error' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      RuntimeError
    );

    expect(() => (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx)).toThrow(
      /Failed to spawn claude binary/
    );
  });
});

// ============================================================
// EC-8: Timeout exceeded
// EC-10 spec: non-zero exit yields error chunk; stream resolves with partial data
// ============================================================

describe('EC-8, AC-8: Timeout exceeded', () => {
  it('yields error chunk containing timeout message in stream', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 1,
      duration: 0,
    });

    // Mock spawn to return process that times out (exitCode rejects)
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 5000ms',
          undefined,
          { timeoutMs: 5000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // fn() returns a RillStream synchronously; exitCode rejection surfaces as error chunk
    const stream = (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx);
    const chunks = await collectChunks(stream);

    // EC-10: error chunk is yielded containing the error message
    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI timeout after 5000ms');
  });
});

// ============================================================
// EC-9: Non-zero exit code
// EC-10 spec: non-zero exit yields error chunk; stream resolves with partial data
// ============================================================

describe('EC-9, AC-9: Non-zero exit code', () => {
  it('yields error chunk containing exit code in stream', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 1,
      duration: 0,
    });

    // Mock spawn to return process that exits with code 1 (exitCode rejects)
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 1',
          undefined,
          { exitCode: 1 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx);
    const chunks = await collectChunks(stream);

    // EC-10: error chunk is yielded containing the exit code message
    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code 1');
  });

  it('stream resolves with partial data on exit code 127', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 127,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 127',
          undefined,
          { exitCode: 127 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx);
    const chunks = await collectChunks(stream);

    expect(chunks.some((c) => c.includes('127'))).toBe(true);

    // Stream still resolves after error chunk (EC-10: resolves with partial data)
    const result = await resolveStream(stream);
    expect(result).toBeDefined();
  });
});

// ============================================================
// EC-10: Empty skill name
// ============================================================

describe('EC-10: Empty skill name', () => {
  it('throws RuntimeError RILL-R004 "skill name cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Validation throws synchronously before stream creation
    expect(() => (ext.value as any).skill.fn({ name: '', args: {} }, ctx)).toThrow(RuntimeError);

    expect(() => (ext.value as any).skill.fn({ name: '', args: {} }, ctx)).toThrow(
      'skill name cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only skill name', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).skill.fn({ name: '   ', args: {} }, ctx)).toThrow(
      'skill name cannot be empty'
    );
  });
});

// ============================================================
// EC-11: Invalid skill name (non-zero exit) — yields error chunk
// ============================================================

describe('EC-11: Invalid skill name (non-zero exit)', () => {
  it('yields error chunk containing exit code when skill exits non-zero', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 2,
      duration: 0,
    });

    // Mock spawn to return process that exits with non-zero code (exitCode rejects)
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 2',
          undefined,
          { exitCode: 2 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).skill.fn({ name: 'invalid-skill', args: {} }, ctx);
    const chunks = await collectChunks(stream);

    // EC-10: error chunk is yielded
    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code');
  });
});

// ============================================================
// EC-12: Skill spawn/parse/timeout
// ============================================================

describe('EC-12: Skill spawn/parse/timeout errors', () => {
  it('throws RuntimeError for spawn error (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // spawnClaudeCli throws synchronously → fn() throws before stream
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Failed to spawn claude binary: test error',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).skill.fn({ name: 'test-skill', args: {} }, ctx)).toThrow(
      /Failed to spawn claude binary/
    );
  });

  it('yields error chunk for timeout (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 10000ms',
          undefined,
          { timeoutMs: 10000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).skill.fn({ name: 'test-skill', args: {} }, ctx);
    const chunks = await collectChunks(stream);

    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI timeout after');
  });
});

// ============================================================
// EC-13: Empty command name
// ============================================================

describe('EC-13: Empty command name', () => {
  it('throws RuntimeError RILL-R004 "command name cannot be empty"', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Validation throws synchronously before stream creation
    expect(() => (ext.value as any).command.fn({ name: '', args: {} }, ctx)).toThrow(RuntimeError);

    expect(() => (ext.value as any).command.fn({ name: '', args: {} }, ctx)).toThrow(
      'command name cannot be empty'
    );
  });

  it('throws RuntimeError for whitespace-only command name', async () => {
    const which = await import('which');
    vi.mocked(which.default.sync).mockReturnValue('claude');

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).command.fn({ name: '\t\n', args: {} }, ctx)).toThrow(
      'command name cannot be empty'
    );
  });
});

// ============================================================
// EC-14: Invalid command (non-zero exit) — yields error chunk
// ============================================================

describe('EC-14: Invalid command (non-zero exit)', () => {
  it('yields error chunk containing exit code when command exits non-zero', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 3,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI exited with code 3',
          undefined,
          { exitCode: 3 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).command.fn({ name: 'invalid-command', args: {} }, ctx);
    const chunks = await collectChunks(stream);

    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI exited with code');
  });
});

// ============================================================
// EC-15: Command spawn/parse/timeout
// ============================================================

describe('EC-15: Command spawn/parse/timeout errors', () => {
  it('throws RuntimeError for spawn error (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // spawnClaudeCli throws synchronously → fn() throws before stream
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'claude binary not found',
        undefined,
        { binaryPath: 'claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).command.fn({ name: 'test-command', args: {} }, ctx)).toThrow(
      /claude binary not found/
    );
  });

  it('yields error chunk for timeout (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');
    vi.mocked(createStreamParser).mockReturnValue({ processChunk: vi.fn(), flush: vi.fn() });
    vi.mocked(extractResult).mockReturnValue({
      result: '',
      tokens: { prompt: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
      cost: 0,
      exitCode: 1,
      duration: 0,
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: Promise.reject(
        new RuntimeError(
          'RILL-R004',
          'Claude CLI timeout after 15000ms',
          undefined,
          { timeoutMs: 15000 }
        )
      ),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    const stream = (ext.value as any).command.fn({ name: 'test-command', args: {} }, ctx);
    const chunks = await collectChunks(stream);

    const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
    expect(errorChunks.length).toBeGreaterThan(0);
    expect(errorChunks[0]).toContain('Claude CLI timeout after');
  });

  it('throws RuntimeError for permission denied (same as prompt)', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // spawnClaudeCli throws synchronously → fn() throws before stream
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      throw new RuntimeError(
        'RILL-R004',
        'Permission denied: claude',
        undefined,
        { binaryPath: '/usr/bin/claude' }
      );
    });

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    expect(() => (ext.value as any).command.fn({ name: 'test-command', args: {} }, ctx)).toThrow(
      /Permission denied: claude/
    );
  });
});

// ============================================================
// EC-16: Cleanup failure on dispose
// ============================================================

describe('EC-16: Cleanup failure on dispose', () => {
  it('logs warning and does not throw when dispose cleanup fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create a dispose function that throws
    const failingDispose = vi.fn(() => {
      throw new Error('Cleanup failure');
    });

    // Return a pending promise so dispose is called while process is still running
    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise(() => {}), // Never resolves
      dispose: failingDispose,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start prompt (don't await - it will never complete)
    const promptStream = (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx);

    // Dispose while process is still running - should log warning, not throw
    expect(() => ext.dispose?.()).not.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process')
    );

    consoleWarnSpy.mockRestore();

    // Catch any unresolved stream to avoid warnings
    resolveStream(promptStream).catch(() => {});
  });

  it('continues cleanup for all disposers even if one fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create multiple disposers - first fails, second succeeds
    const failingDispose = vi.fn(() => {
      throw new Error('Cleanup failure');
    });
    const successDispose = vi.fn();

    let callCount = 0;
    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      callCount++;
      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise(() => {}), // Never resolves
        dispose: callCount === 1 ? failingDispose : successDispose,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start two prompts (don't await - they will never complete)
    const stream1 = (ext.value as any).prompt.fn({ text: 'test1', options: {} }, ctx);
    const stream2 = (ext.value as any).prompt.fn({ text: 'test2', options: {} }, ctx);

    // Dispose should call both, log warning for first, not throw
    expect(() => ext.dispose?.()).not.toThrow();

    expect(failingDispose).toHaveBeenCalled();
    expect(successDispose).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process')
    );

    consoleWarnSpy.mockRestore();

    // Catch the unresolved streams to avoid warnings
    resolveStream(stream1).catch(() => {});
    resolveStream(stream2).catch(() => {});
  });

  it('handles non-Error cleanup failures', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Disposer throws non-Error object
    const failingDispose = vi.fn(() => {
      throw 'string error';
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as any,
      exitCode: new Promise(() => {}), // Never resolves
      dispose: failingDispose,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    const ext = createClaudeCodeExtension();
    const ctx = createRuntimeContext();

    // Start prompt (don't await - it will never complete)
    const promptStream = (ext.value as any).prompt.fn({ text: 'test', options: {} }, ctx);

    expect(() => ext.dispose?.()).not.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to cleanup process: Unknown error')
    );

    consoleWarnSpy.mockRestore();

    // Catch the unresolved stream to avoid warnings
    resolveStream(promptStream).catch(() => {});
  });
});
