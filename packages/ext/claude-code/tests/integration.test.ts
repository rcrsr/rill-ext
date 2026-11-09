/**
 * Integration tests for Claude Code extension success cases.
 * Tests extension factory and result structure with mocked stream parser and result extractor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { SpawnError } from '../src/errors.js';
import {
  makeFactoryCtx,
  expectInvalidThrow,
  extValue,
  type StreamStep,
} from './_helpers.js';
import type { IPty } from 'node-pty';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  isRillStream,
  type RillValue,
} from '@rcrsr/rill';

// Mock which module
vi.mock('which', () => ({
  default: {
    sync: vi.fn(() => 'claude'),
  },
}));

// Mock node-pty to avoid native module loading
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock the entire process and result extraction stack
vi.mock('../src/process.js');
vi.mock('../src/stream-parser.js');
vi.mock('../src/result.js');

// ============================================================
// STREAM HELPERS
// ============================================================

/**
 * Resolve a RillStream by calling its hidden __rill_stream_resolve property.
 */
function resolveStream<T = Record<string, unknown>>(
  stream: unknown
): Promise<T> {
  return (
    stream as { __rill_stream_resolve: () => Promise<T> }
  ).__rill_stream_resolve();
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected string chunks.
 */
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

describe('Claude Code Extension Integration Tests - Success Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-10: prompt() returns RillStream
  describe('AC-10: prompt/skill/command return RillStream', () => {
    it.each([
      { fn: 'prompt' as const, args: { text: 'Hello Claude', options: {} } },
      { fn: 'skill' as const, args: { name: 'test-skill', args: {} } },
      { fn: 'command' as const, args: { name: 'test-command', args: {} } },
    ])('returns a RillStream from $fn()', async ({ fn, args }) => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Hello!',
        tokens: {
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 8,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 1200,
      });
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: Promise.resolve(0),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext)[fn].fn(args, ctx);

      expect(isRillStream(stream as RillValue)).toBe(true);
    });
  });

  // AC-11: Iterating Claude Code streams yields string stdout line chunks
  describe('AC-11: Iterating stream yields string stdout line chunks', () => {
    it('yields each PTY output line as a string chunk in order', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Hello!',
        tokens: {
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 8,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 1200,
      });

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn((cb: (chunk: string) => void) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb: (event: { exitCode: number }) => void) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((resolve) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback('line one\nline two\n');
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 5);
        }),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );

      expect(isRillStream(stream as RillValue)).toBe(true);

      const chunks = await collectChunks(stream);

      // Each PTY line arrives as its own string chunk, in emission order
      expect(chunks).toEqual(['line one', 'line two']);
    });
  });

  describe('AC-2: Skill with args passes serialized flags, returns result', () => {
    it('serializes boolean and nested dict args correctly', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Skill executed',
        tokens: {
          prompt: 15,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5,
        },
        cost: 0.002,
        exit_code: 0,
        duration: 800,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: Promise.resolve(0),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext).skill.fn(
        {
          name: 'test-skill',
          args: {
            verbose: true,
            config: { level: 'debug', output: 'json' },
            retries: 3,
          },
        },
        ctx
      );

      // Verify spawn was called with serialized args (AC-2)
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        '/test-skill --verbose --config.level debug --config.output json --retries 3',
        expect.objectContaining({ binaryPath: 'claude' })
      );

      const result = await resolveStream(stream);
      expect(result['result']).toBe('Skill executed');
      expect(result['exit_code']).toBe(0);
    });
  });

  describe('AC-3: Custom timeout respects timeout option value', () => {
    it('propagates custom timeout to process manager', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 3,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 500,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: Promise.resolve(0),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension(
        { defaultTimeout: 1800000 },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const stream = extValue(ext).prompt.fn(
        { text: 'Test prompt', options: { timeout: 60000 } },
        ctx
      );
      await resolveStream(stream);

      // Verify custom timeout was passed (AC-3)
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 60000 })
      );
    });

    it('uses default timeout when option not provided', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 3,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 500,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: Promise.resolve(0),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension(
        { defaultTimeout: 45000 },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const stream = extValue(ext).prompt.fn(
        { text: 'Test prompt', options: {} },
        ctx
      );
      await resolveStream(stream);

      // Verify default timeout was used
      expect(spawnClaudeCli).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({ timeoutMs: 45000 })
      );
    });
  });
});

// ============================================================
// ERROR CONTRACT TESTS
// ============================================================

describe('Claude Code Extension Integration Tests - Error Contracts', () => {
  // EC-8: Binary not found invalidates with #UNAVAILABLE
  describe('EC-8: Binary not found invalidates with #UNAVAILABLE', () => {
    it('prompt() invalidates when spawnClaudeCli throws SpawnError(binary_missing)', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');

      vi.mocked(spawnClaudeCli).mockImplementation(() => {
        throw new SpawnError('binary_missing', 'claude binary not found', {
          binaryPath: 'claude',
        });
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      expectInvalidThrow(
        () =>
          extValue(ext).prompt.fn({ text: 'Hello Claude', options: {} }, ctx),
        'UNAVAILABLE',
        'claude binary not found'
      );
    });
  });

  // EC-9: Process timeout maps to invalid RillValue with #TIMEOUT
  describe('EC-9: Process timeout invalidates with #TIMEOUT', () => {
    it('stream resolve() returns invalid #TIMEOUT when process times out', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
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
        exit_code: 0,
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
            timeoutMs: 5000,
          })
        ),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext).prompt.fn(
        { text: 'Hello Claude', options: { timeout: 5000 } },
        ctx
      );
      await collectChunks(stream);
      const result = (await resolveStream(stream)) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('TIMEOUT');
    });
  });

  // EC-10 / AC-18: Non-zero exit mid-stream yields error chunk; resolves with partial data
  describe('EC-10 / AC-18: Non-zero exit mid-stream yields error chunk, stream resolves', () => {
    it('yields error chunk on non-zero exit and stream resolves with partial data', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn<() => void>(),
        flush: vi.fn<() => void>(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'partial output',
        tokens: {
          prompt: 5,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 2,
        },
        cost: 0.0005,
        exit_code: 1,
        duration: 300,
      });

      let onDataCallback: ((chunk: string) => void) | undefined;

      const exitError = new SpawnError(
        'exit_nonzero',
        'Claude CLI exited with code 1',
        {
          exit_code: 1,
        }
      );

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn((cb: (chunk: string) => void) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((_, reject) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback('partial output line\n');
            }
            reject(exitError);
          }, 5);
        }),
        dispose: vi.fn<() => void>(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );

      // Collect all chunks including the error chunk
      const chunks = await collectChunks(stream);

      // EC-10: An error chunk is present in the stream
      expect(chunks.some((c) => c.includes('[error]'))).toBe(true);

      // AC-18: Stream resolves with an invalid RillValue carrying #UNAVAILABLE.
      const result = (await resolveStream(stream)) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
    });
  });

  // EC-11: PTY spawn failure invalidates with #UNAVAILABLE
  describe('EC-11: PTY spawn failure invalidates with #UNAVAILABLE', () => {
    it('prompt() invalidates with spawn failure message', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');

      vi.mocked(spawnClaudeCli).mockImplementation(() => {
        throw new SpawnError(
          'spawn_failed',
          'Failed to spawn claude binary: spawn error detail',
          {
            binaryPath: 'claude',
            originalError: 'spawn error detail',
          }
        );
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      expectInvalidThrow(
        () => extValue(ext).prompt.fn({ text: 'Hello', options: {} }, ctx),
        'UNAVAILABLE',
        'Failed to spawn claude binary'
      );
    });

    it('skill() invalidates with spawn failure message', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');

      vi.mocked(spawnClaudeCli).mockImplementation(() => {
        throw new SpawnError(
          'spawn_failed',
          'Failed to spawn claude binary: permission denied',
          {
            binaryPath: 'claude',
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

    it('command() invalidates with spawn failure message', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');

      vi.mocked(spawnClaudeCli).mockImplementation(() => {
        throw new SpawnError(
          'spawn_failed',
          'Failed to spawn claude binary: resource unavailable',
          {
            binaryPath: 'claude',
          }
        );
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      expectInvalidThrow(
        () => extValue(ext).command.fn({ name: 'test-command', args: {} }, ctx),
        'UNAVAILABLE',
        'Failed to spawn claude binary'
      );
    });
  });

  // ============================================================
  // BOUNDARY CONDITION TESTS
  describe('boundary conditions', () => {
    // AC-22: Second iteration of a consumed Claude Code stream throws RILL-R002
    describe('AC-22: second iteration of consumed Claude Code stream throws RILL-R002', () => {
      it('calling next() on consumed stream root step throws RILL-R002', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        let onDataCb: ((chunk: string) => void) | undefined;
        let onExitCb: ((event: { exitCode: number }) => void) | undefined;

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn<() => void>(),
          flush: vi.fn<() => void>(),
        });
        vi.mocked(extractResult).mockReturnValue({
          result: 'Done',
          tokens: {
            prompt: 5,
            cache_write_5m: 0,
            cache_write_1h: 0,
            cache_read: 0,
            output: 3,
          },
          cost: 0.001,
          exit_code: 0,
          duration: 200,
        });
        vi.mocked(spawnClaudeCli).mockReturnValue({
          ptyProcess: {
            onData: vi.fn((cb: (chunk: string) => void) => {
              onDataCb = cb;
            }),
            onExit: vi.fn((cb: (event: { exitCode: number }) => void) => {
              onExitCb = cb;
            }),
            write: vi.fn(),
            kill: vi.fn(),
          } as unknown as IPty,
          exitCode: new Promise<number>((resolve) => {
            setTimeout(() => {
              if (onDataCb) onDataCb('output line\n');
              if (onExitCb) onExitCb({ exitCode: 0 });
              resolve(0);
            }, 5);
          }),
          dispose: vi.fn<() => void>(),
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = extValue(ext).prompt.fn(
          { text: 'Test', options: {} },
          ctx
        );

        // Navigate manually to the done step (replicates collectChunks but keeps the done step)
        let current: StreamStep = stream as StreamStep;
        while (!current.done) {
          current = (await current.next.fn({}, null)) as StreamStep;
        }

        // Re-iterating the done step throws RILL-R002 synchronously
        // (the done step's callable is a sync function that throws, not async)
        expect(() => current.next.fn({}, null)).toThrow(
          /#RILL_R002: Stream already consumed; cannot re-iterate/
        );
      });
    });

    // AC-27: Abandoned Claude Code stream triggers dispose cleanup
    describe('AC-27: abandoned Claude Code stream triggers dispose callback', () => {
      it('calling __rill_stream_dispose invokes spawn cleanup', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        const mockDispose = vi.fn<() => void>();

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn<() => void>(),
          flush: vi.fn<() => void>(),
        });
        vi.mocked(extractResult).mockReturnValue({
          result: 'Done',
          tokens: {
            prompt: 5,
            cache_write_5m: 0,
            cache_write_1h: 0,
            cache_read: 0,
            output: 3,
          },
          cost: 0.001,
          exit_code: 0,
          duration: 200,
        });
        vi.mocked(spawnClaudeCli).mockReturnValue({
          ptyProcess: {
            onData: vi.fn(),
            onExit: vi.fn(),
            write: vi.fn(),
            kill: vi.fn(),
          } as unknown as IPty,
          exitCode: new Promise(() => {
            /* never resolves — simulates abandoned stream */
          }),
          dispose: mockDispose,
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = extValue(ext).prompt.fn(
          { text: 'Long task', options: {} },
          ctx
        );

        // Simulate abandonment: invoke the hidden dispose property
        const disposeStream = (stream as { __rill_stream_dispose: () => void })
          .__rill_stream_dispose;
        expect(typeof disposeStream).toBe('function');

        disposeStream();

        // The dispose callback on the stream calls spawn.dispose()
        expect(mockDispose).toHaveBeenCalledTimes(1);
      });

      it('dispose is idempotent: calling twice invokes spawn.dispose() only once', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        const mockDispose = vi.fn<() => void>();

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn<() => void>(),
          flush: vi.fn<() => void>(),
        });
        vi.mocked(extractResult).mockReturnValue({
          result: 'Done',
          tokens: {
            prompt: 5,
            cache_write_5m: 0,
            cache_write_1h: 0,
            cache_read: 0,
            output: 3,
          },
          cost: 0.001,
          exit_code: 0,
          duration: 200,
        });
        vi.mocked(spawnClaudeCli).mockReturnValue({
          ptyProcess: {
            onData: vi.fn(),
            onExit: vi.fn(),
            write: vi.fn(),
            kill: vi.fn(),
          } as unknown as IPty,
          exitCode: new Promise(() => {
            /* never resolves */
          }),
          dispose: mockDispose,
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = extValue(ext).prompt.fn(
          { text: 'Long task', options: {} },
          ctx
        );
        const disposeStream = (stream as { __rill_stream_dispose: () => void })
          .__rill_stream_dispose;

        disposeStream();
        disposeStream();

        // createRillStream wraps dispose to be idempotent — spawn.dispose() called once
        expect(mockDispose).toHaveBeenCalledTimes(1);
      });
    });
  });
});
