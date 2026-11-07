/**
 * Integration tests for Claude Code extension prefixFunctions and dispose.
 * Tests extension factory with prefixFunctions utility and cleanup lifecycle.
 *
 * Covers: IC-7, IR-1, IR-5, EC-16
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { makeFactoryCtx, extValue } from './_helpers.js';
import type { IPty } from 'node-pty';
import { createRuntimeContext } from '@rcrsr/rill';

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
async function resolveStream<T = Record<string, unknown>>(
  stream: unknown
): Promise<T> {
  return (
    stream as { __rill_stream_resolve: () => Promise<T> }
  ).__rill_stream_resolve();
}

// ============================================================
// IR-5: dispose terminates active child processes
// ============================================================

describe('IR-5: dispose terminates active child processes', () => {
  it('calls dispose on active processes when extension dispose is invoked', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Track dispose calls
    const disposeFn = vi.fn();

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn((_cb) => {
          // Don't resolve immediately to keep process active
        }),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: new Promise(() => {
        // Never resolves to keep process active
      }),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start prompt but don't await completion — fn() returns RillStream synchronously
    const stream = extValue(ext).prompt.fn({ text: 'Test', options: {} }, ctx);

    // Wait briefly for process to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify dispose not called yet
    expect(disposeFn).not.toHaveBeenCalled();

    // Call extension dispose
    ext.dispose!();

    // Verify dispose was called
    expect(disposeFn).toHaveBeenCalledTimes(1);

    // Cleanup: ensure stream doesn't hang test
    resolveStream(stream).catch(() => {});
  });

  it('terminates multiple concurrent active processes', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposeFns: Array<Mock<() => void>> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise(() => {
          // Never resolves
        }),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start 5 concurrent prompts — fn() returns RillStream synchronously
    const streams = Array.from({ length: 5 }, (_, i) =>
      extValue(ext).prompt.fn({ text: `Prompt ${i}`, options: {} }, ctx)
    );

    // Wait briefly for processes to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify all dispose functions created
    expect(disposeFns).toHaveLength(5);

    // Verify no dispose calls yet
    disposeFns.forEach((fn) => {
      expect(fn).not.toHaveBeenCalled();
    });

    // Call extension dispose
    ext.dispose!();

    // Verify all dispose functions called
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Cleanup: ensure streams don't hang test
    streams.forEach((s) => resolveStream(s).catch(() => {}));
  });
});

// ============================================================
// IR-5: dispose is idempotent (multiple calls safe)
// ============================================================

describe('IR-5: dispose is idempotent (multiple calls safe)', () => {
  it('clears active process tracker after first dispose', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const disposeFns: Array<Mock<() => void>> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start 3 processes — fn() returns RillStream synchronously
    const streams = [
      extValue(ext).prompt.fn({ text: 'Test 1', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Test 2', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Test 3', options: {} }, ctx),
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));

    // First dispose
    ext.dispose!();

    // Verify all 3 disposed
    expect(disposeFns).toHaveLength(3);
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Reset mock call counts
    disposeFns.forEach((fn) => fn.mockClear());

    // Second dispose should not call any dispose functions (tracker cleared)
    ext.dispose!();

    disposeFns.forEach((fn) => {
      expect(fn).not.toHaveBeenCalled();
    });

    // Cleanup
    streams.forEach((s) => resolveStream(s).catch(() => {}));
  });
});

// ============================================================
// EC-16: dispose cleanup failure logs warning, does not throw
// ============================================================

describe('EC-16: dispose cleanup failure logs warning, does not throw', () => {
  it('logs warning when process dispose throws error', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    // Mock console.warn to capture warnings
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const disposeFn = vi.fn(() => {
      throw new Error('Process cleanup failed');
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: new Promise(() => {}),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start process — fn() returns RillStream synchronously
    const stream = extValue(ext).prompt.fn({ text: 'Test', options: {} }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Call dispose - should not throw despite error
    expect(() => ext.dispose!()).not.toThrow();

    // Verify warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Process cleanup failed'
    );

    // Cleanup
    warnSpy.mockRestore();
    resolveStream(stream).catch(() => {});
  });

  it('logs warning for unknown error types', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Throw non-Error object
    const disposeFn = vi.fn(() => {
      throw 'String error';
    });

    vi.mocked(spawnClaudeCli).mockReturnValue({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: new Promise(() => {}),
      dispose: disposeFn,
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const stream = extValue(ext).prompt.fn({ text: 'Test', options: {} }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Call dispose
    expect(() => ext.dispose!()).not.toThrow();

    // Verify generic warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Unknown error'
    );

    warnSpy.mockRestore();
    resolveStream(stream).catch(() => {});
  });

  it('continues disposing remaining processes after one fails', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const disposeFns: Array<() => void> = [];

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const index = disposeFns.length;
      const disposeFn = vi.fn(() => {
        // Second process throws error
        if (index === 1) {
          throw new Error('Dispose failed');
        }
      });
      disposeFns.push(disposeFn);

      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start 3 processes — fn() returns RillStream synchronously
    const streams = [
      extValue(ext).prompt.fn({ text: 'Test 1', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Test 2', options: {} }, ctx),
      extValue(ext).prompt.fn({ text: 'Test 3', options: {} }, ctx),
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dispose all
    expect(() => ext.dispose!()).not.toThrow();

    // Verify all 3 dispose functions called
    expect(disposeFns).toHaveLength(3);
    disposeFns.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });

    // Verify warning logged for failed disposal
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to cleanup process: Dispose failed'
    );

    warnSpy.mockRestore();
    streams.forEach((s) => resolveStream(s).catch(() => {}));
  });
});

// ============================================================
// IR-1: Factory creation is idempotent
// ============================================================

describe('IR-1: Factory creation is idempotent', () => {
  it('creates independent instances that do not share state', async () => {
    const which = await import('which');
    const { spawnClaudeCli } = await import('../src/process.js');
    const { createStreamParser } = await import('../src/stream-parser.js');
    const { extractResult } = await import('../src/result.js');

    vi.mocked(which.default.sync).mockReturnValue('claude');

    vi.mocked(spawnClaudeCli).mockImplementation(() => {
      const disposeFn = vi.fn();
      // Store dispose function for verification
      return {
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as unknown as IPty,
        exitCode: new Promise(() => {}),
        dispose: disposeFn,
      };
    });

    vi.mocked(createStreamParser).mockReturnValue({
      processChunk: vi.fn(),
      flush: vi.fn(),
    });

    vi.mocked(extractResult).mockReturnValue({
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });

    const ext1 = createClaudeCodeExtension({}, makeFactoryCtx());
    const ext2 = createClaudeCodeExtension({}, makeFactoryCtx());
    const ext3 = createClaudeCodeExtension({}, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // Start process on each instance — fn() returns RillStream synchronously
    const stream1 = extValue(ext1).prompt.fn(
      { text: 'Test 1', options: {} },
      ctx
    );
    const stream2 = extValue(ext2).prompt.fn(
      { text: 'Test 2', options: {} },
      ctx
    );
    const stream3 = extValue(ext3).prompt.fn(
      { text: 'Test 3', options: {} },
      ctx
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Dispose first instance only
    ext1.dispose!();

    // Track which dispose was called
    const disposeCalls = vi.mocked(spawnClaudeCli).mock.results.map((r) => {
      const proc = r.value;
      return proc.dispose.mock.calls.length;
    });

    // Verify only first process disposed
    expect(disposeCalls[0]).toBe(1); // ext1 process
    expect(disposeCalls[1]).toBe(0); // ext2 process (not disposed)
    expect(disposeCalls[2]).toBe(0); // ext3 process (not disposed)

    // Dispose second instance
    ext2.dispose!();

    const disposeCalls2 = vi.mocked(spawnClaudeCli).mock.results.map((r) => {
      const proc = r.value;
      return proc.dispose.mock.calls.length;
    });

    expect(disposeCalls2[0]).toBe(1); // ext1 (already disposed)
    expect(disposeCalls2[1]).toBe(1); // ext2 (now disposed)
    expect(disposeCalls2[2]).toBe(0); // ext3 (still not disposed)

    // Cleanup
    [stream1, stream2, stream3].forEach((s) =>
      resolveStream(s).catch(() => {})
    );
  });

  it('applies each instance defaultTimeout independently', async () => {
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
      result: 'Test',
      tokens: {
        prompt: 5,
        cache_write_5m: 0,
        cache_write_1h: 0,
        cache_read: 0,
        output: 3,
      },
      cost: 0.001,
      exit_code: 0,
      duration: 100,
    });
    vi.mocked(spawnClaudeCli).mockImplementation(() => ({
      ptyProcess: {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      } as unknown as IPty,
      exitCode: Promise.resolve(0),
      dispose: vi.fn(),
    }));

    const timeouts = [10000, 20000, 30000];
    const ctx = createRuntimeContext();

    for (const [i, defaultTimeout] of timeouts.entries()) {
      const ext = createClaudeCodeExtension(
        { defaultTimeout },
        makeFactoryCtx()
      );
      const stream = extValue(ext).prompt.fn(
        { text: `Prompt ${i}`, options: {} },
        ctx
      );
      await resolveStream(stream);
    }

    expect(
      vi
        .mocked(spawnClaudeCli)
        .mock.calls.map(([text, opts]) => [text, opts?.timeoutMs])
    ).toEqual([
      ['Prompt 0', 10000],
      ['Prompt 1', 20000],
      ['Prompt 2', 30000],
    ]);
  });
});
