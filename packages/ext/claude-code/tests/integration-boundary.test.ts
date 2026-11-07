/**
 * Integration tests for Claude Code extension boundary conditions.
 * Tests large output handling, concurrent calls, and sequential calls for resource leaks.
 *
 * Covers: IC-7, AC-14, AC-15, AC-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { SpawnError } from '../src/errors.js';
import { makeFactoryCtx, extValue, type StreamStep } from './_helpers.js';
import type { IPty } from 'node-pty';
import type { ClaudeMessage } from '../src/types.js';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type RillValue,
} from '@rcrsr/rill';

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
async function resolveStream(
  stream: unknown
): Promise<Record<string, unknown>> {
  return (
    stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }
  ).__rill_stream_resolve();
}

/**
 * Consume all chunks from a RillStream by iterating via next() calls.
 * Returns collected string chunks. Call before resolveStream() to ensure
 * the generator has fully processed all data.
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

// ============================================================
// AC-14: 10K line output parses without memory growth
// ============================================================

describe('10K line output streams through the parser', () => {
  it('yields every one of 10K PTY lines and forwards all 100 chunks to the parser', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Create parser that collects chunks
    const processedChunks: string[] = [];
    const mockParser = {
      processChunk: vi.fn(
        (chunk: string, callback: (msg: ClaudeMessage) => void) => {
          processedChunks.push(chunk);
          // Simulate parsing JSON lines from chunks
          const lines = chunk.split('\n').filter((line) => line.trim());
          lines.forEach((line) => {
            try {
              const msg = JSON.parse(line);
              callback(msg);
            } catch {
              // Ignore non-JSON lines
            }
          });
        }
      ),
      flush: vi.fn(),
    };

    vi.mocked(createStreamParser).mockReturnValue(mockParser);

    // Mock extractResult to return successful result
    vi.mocked(extractResult).mockReturnValue({
      result: 'Processed 10000 lines successfully',
      tokens: {
        prompt: 100,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 50,
      },
      cost: 0.01,
      exit_code: 0,
      duration: 5000,
    });

    // Mock spawn to simulate 10K line output
    let onDataCallback: ((chunk: string) => void) | undefined;
    let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn((cb) => {
          onDataCallback = cb;
        }),
        onExit: vi.fn((cb) => {
          onExitCallback = cb;
        }),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: new Promise<number>((resolve) => {
        // Simulate streaming 10K lines in chunks of 100 lines
        setTimeout(() => {
          const linesPerChunk = 100;
          const totalLines = 10000;
          const chunks = totalLines / linesPerChunk;

          for (let i = 0; i < chunks; i++) {
            const chunkLines: string[] = [];
            for (let j = 0; j < linesPerChunk; j++) {
              const lineNum = i * linesPerChunk + j + 1;
              chunkLines.push(
                JSON.stringify({
                  type: 'content',
                  text: `Line ${lineNum} of output`,
                })
              );
            }
            // Send chunk via onData callback
            if (onDataCallback) {
              onDataCallback(chunkLines.join('\n') + '\n');
            }
          }

          // Send completion event
          if (onExitCallback) {
            onExitCallback({ exitCode: 0 });
          }
          resolve(0);
        }, 10);
      }),
      dispose: vi.fn(),
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Execute prompt — fn() returns RillStream synchronously
    const stream = extValue(ext).prompt.fn(
      { text: 'Process large output', options: {} },
      ctx
    );

    // Iterate all chunks first so the generator runs and processes data
    const yieldedLines = await collectChunks(stream);

    // Resolve stream to get final result
    const result = await resolveStream(stream);

    // Verify result extracted correctly
    expect(result['result']).toBe('Processed 10000 lines successfully');
    expect(result['exit_code']).toBe(0);

    // Every PTY line is yielded once, in order
    expect(yieldedLines).toHaveLength(10000);
    expect(yieldedLines[0]).toBe(
      JSON.stringify({ type: 'content', text: 'Line 1 of output' })
    );
    expect(yieldedLines[9999]).toBe(
      JSON.stringify({ type: 'content', text: 'Line 10000 of output' })
    );

    // The parser receives every PTY chunk (10K lines at 100 lines per chunk)
    expect(mockParser.processChunk).toHaveBeenCalledTimes(100);
    expect(processedChunks).toHaveLength(100);
  });
});

// ============================================================
// AC-15: Concurrent 10 calls each complete independently
// ============================================================

describe('AC-15: Concurrent 10 calls each complete independently', () => {
  it('executes 10 concurrent prompts that all complete with their own result', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track spawn calls to ensure each gets unique process
    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((resolve) => {
          // Deterministic, varying completion times (50-149ms)
          const delay = 50 + ((callIndex * 37) % 100);
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(
                JSON.stringify({
                  type: 'content',
                  text: `Response from call ${callIndex}`,
                }) + '\n'
              );
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, delay);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn(
        (chunk: string, callback: (msg: ClaudeMessage) => void) => {
          try {
            const msg = JSON.parse(chunk.trim());
            callback(msg);
          } catch {
            // Ignore parse errors
          }
        }
      ),
      flush: vi.fn(),
    }));

    // Mock extractResult to return results based on parsed message content
    vi.mocked(extractResult).mockImplementation((messages) => {
      // Extract call index from message content
      // The fixture emits a non-protocol 'content' message carrying the text
      const msg = (
        messages as ReadonlyArray<{ type: string; text?: string }>
      ).find((m) => m.type === 'content');
      const match = msg?.text?.match(/Response from call (\d+)/);
      const callNum = match ? parseInt(match[1] ?? '0', 10) : 0;

      return {
        result: `Response from call ${callNum}`,
        tokens: {
          prompt: 10 + callNum,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5 + callNum,
        },
        cost: 0.001 * (callNum + 1),
        exit_code: 0,
        duration: 100 + callNum * 10,
      };
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Execute 10 concurrent prompts — each fn() call returns a RillStream synchronously
    const streams = Array.from({ length: 10 }, (_, i) =>
      extValue(ext).prompt.fn({ text: `Prompt ${i}`, options: {} }, ctx)
    );

    // For each stream: iterate chunks (so generator processes all data), then resolve
    async function drainAndResolve(
      s: unknown
    ): Promise<Record<string, unknown>> {
      await collectChunks(s);
      return resolveStream(s);
    }

    // Resolve all streams concurrently
    const results = await Promise.all(streams.map(drainAndResolve));

    // Verify all 10 completed successfully
    expect(results).toHaveLength(10);

    // Collect all result texts to verify uniqueness
    const resultTexts = new Set(results.map((r) => r['result'] as string));

    // Verify each has unique result (10 unique results)
    expect(resultTexts.size).toBe(10);

    // Verify all have exit_code 0
    results.forEach((result) => {
      expect(result['exit_code']).toBe(0);
      expect(result['result'] as string).toMatch(/^Response from call \d+$/);
    });

    // Verify 10 separate processes were spawned
    expect(spawnClaudeCli).toHaveBeenCalledTimes(10);
  });

  it('handles concurrent mix of prompt, skill, and command calls', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((resolve) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(
                JSON.stringify({
                  type: 'content',
                  text: `Response ${callIndex}`,
                }) + '\n'
              );
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 50);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn(
        (chunk: string, callback: (msg: ClaudeMessage) => void) => {
          try {
            callback(JSON.parse(chunk.trim()));
          } catch {
            // Ignore
          }
        }
      ),
      flush: vi.fn(),
    }));

    // Derive each result from the parsed message so the assertion does not
    // depend on the order in which the extractor is called.
    vi.mocked(extractResult).mockImplementation((messages) => {
      const msg = (
        messages as ReadonlyArray<{ type: string; text?: string }>
      ).find((m) => m.type === 'content');
      return {
        result: msg?.text ?? 'missing',
        tokens: {
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 100,
      };
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Execute mixed concurrent calls — all fn() calls return RillStream synchronously
    const streams = [
      extValue(ext).prompt.fn({ text: 'Prompt 1', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Prompt 2', options: {} }, ctx),
      extValue(ext).skill.fn({ name: 'skill-1', args: {} }, ctx),
      extValue(ext).skill.fn({ name: 'skill-2', args: {} }, ctx),
      extValue(ext).command.fn({ name: 'command-1', args: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Prompt 3', options: {} }, ctx),
      extValue(ext).skill.fn({ name: 'skill-3', args: {} }, ctx),
      extValue(ext).command.fn({ name: 'command-2', args: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Prompt 4', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Prompt 5', options: {} }, ctx),
    ];

    const results = await Promise.all(streams.map((s) => resolveStream(s)));

    // Verify all completed
    expect(results).toHaveLength(10);
    results.forEach((result, i) => {
      expect(result['result']).toBe(`Response ${i}`);
      expect(result['exit_code']).toBe(0);
    });

    expect(spawnClaudeCli).toHaveBeenCalledTimes(10);
  });

  it('handles partial failures in concurrent calls without affecting others', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    let spawnCallCount = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const callIndex = spawnCallCount++;
      const shouldFail = callIndex === 3 || callIndex === 7;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((resolve, reject) => {
          setTimeout(() => {
            if (shouldFail) {
              reject(
                new SpawnError(
                  'exit_nonzero',
                  `Claude CLI exited with code 1`,
                  {
                    exit_code: 1,
                  }
                )
              );
            } else {
              if (onDataCallback) {
                onDataCallback(
                  JSON.stringify({ type: 'content', text: `OK ${callIndex}` }) +
                    '\n'
                );
              }
              if (onExitCallback) {
                onExitCallback({ exitCode: 0 });
              }
              resolve(0);
            }
          }, 50);
        }),
        dispose: vi.fn(),
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn(
        (chunk: string, callback: (msg: ClaudeMessage) => void) => {
          try {
            callback(JSON.parse(chunk.trim()));
          } catch {
            // Ignore
          }
        }
      ),
      flush: vi.fn(),
    }));

    vi.mocked(extractResult).mockImplementation((messages) => {
      const msg = (
        messages as ReadonlyArray<{ type: string; text?: string }>
      ).find((m) => m.type === 'content');
      return {
        result: `Success ${msg?.text ?? 'missing'}`,
        tokens: {
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5,
        },
        cost: 0.001,
        exit_code: 0,
        duration: 100,
      };
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // All fn() calls return RillStream synchronously
    const streams = Array.from({ length: 10 }, (_, i) =>
      extValue(ext).prompt.fn({ text: `Prompt ${i}`, options: {} }, ctx)
    );

    // Failed streams (calls 3 and 7) resolve to invalid values instead of rejecting.
    const results = await Promise.allSettled(
      streams.map((s) => resolveStream(s))
    );

    expect(results).toHaveLength(10);
    results.forEach((settled, i) => {
      expect(settled.status).toBe('fulfilled');
      const value = (settled as PromiseFulfilledResult<Record<string, unknown>>)
        .value;
      if (i === 3 || i === 7) {
        expect(isInvalid(value as RillValue)).toBe(true);
        expect(getStatus(value as RillValue).code.name).toBe('UNAVAILABLE');
      } else {
        expect(isInvalid(value as RillValue)).toBe(false);
        expect(value['result']).toBe(`Success OK ${i}`);
        expect(value['exit_code']).toBe(0);
      }
    });

    // Verify 10 separate processes were spawned
    expect(spawnClaudeCli).toHaveBeenCalledTimes(10);
  });
});

// ============================================================
// AC-16: 1000 sequential calls have no resource leaks
// ============================================================

describe('AC-16: 1000 sequential calls have no resource leaks', () => {
  it('executes 1000 sequential prompts without leaks', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track disposer calls to verify cleanup
    const disposers: Array<() => void> = [];
    let activeProcesses = 0;

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      activeProcesses++;

      let onDataCallback: ((chunk: string) => void) | undefined;
      let onExitCallback: ((event: { exitCode: number }) => void) | undefined;

      const dispose = vi.fn(() => {
        activeProcesses--;
      });

      disposers.push(dispose);

      return {
        ptyProcess: {
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise<number>((resolve) => {
          // Fast completion (1ms) to speed up test
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback(JSON.stringify({ type: 'content', text: 'OK' }));
            }
            if (onExitCallback) {
              onExitCallback({ exitCode: 0 });
            }
            resolve(0);
          }, 1);
        }),
        dispose,
      };
    });

    vi.mocked(createStreamParser).mockImplementation(() => ({
      processChunk: vi.fn(
        (chunk: string, callback: (msg: ClaudeMessage) => void) => {
          try {
            callback(JSON.parse(chunk.trim()));
          } catch {
            // Ignore
          }
        }
      ),
      flush: vi.fn(),
    }));

    vi.mocked(extractResult).mockReturnValue({
      result: 'OK',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 50,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Execute 1000 sequential prompts
    for (let i = 0; i < 1000; i++) {
      const stream = extValue(ext).prompt.fn(
        { text: `Prompt ${i}`, options: {} },
        ctx
      );
      const result = await resolveStream(stream);

      expect(result['result']).toBe('OK');
      expect(result['exit_code']).toBe(0);

      // Verify no process leaks (at most 1 active at a time for sequential)
      expect(activeProcesses).toBeLessThanOrEqual(1);
    }

    // Verify all 1000 processes were spawned
    expect(spawnClaudeCli).toHaveBeenCalledTimes(1000);

    // Verify all disposers were called
    expect(disposers).toHaveLength(1000);
    disposers.forEach((dispose) => {
      expect(dispose).toHaveBeenCalled();
    });

    // Verify no active processes remain
    expect(activeProcesses).toBe(0);
  }, 30000);
});
