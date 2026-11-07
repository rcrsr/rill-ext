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
// SETUP HELPERS
// ============================================================

type FnName = 'prompt' | 'skill' | 'command';

const ARGS_BY_FN: Record<FnName, Record<string, RillValue>> = {
  prompt: { text: 'test', options: {} },
  skill: { name: 'test-skill', args: {} },
  command: { name: 'test-command', args: {} },
};

function argsFor(fn: FnName): Record<string, RillValue> {
  return ARGS_BY_FN[fn];
}

async function mockSpawnThrows(error: SpawnError): Promise<void> {
  const { spawnClaudeCli } = await import('../src/process.js');
  vi.mocked(spawnClaudeCli).mockImplementation(() => {
    throw error;
  });
}

async function mockExitRejects(error: SpawnError): Promise<void> {
  const { spawnClaudeCli } = await import('../src/process.js');
  const { createStreamParser } = await import('../src/stream-parser.js');

  vi.mocked(createStreamParser).mockReturnValue({
    processChunk: vi.fn(),
    flush: vi.fn(),
  });
  vi.mocked(spawnClaudeCli).mockReturnValue({
    ptyProcess: {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
    } as unknown as IPty,
    exitCode: Promise.reject(error),
    dispose: vi.fn(),
  });
}

beforeEach(async () => {
  const which = await import('which');
  vi.mocked(which.default.sync).mockReturnValue('claude');
});

// ============================================================
// Spawn-time failures invalidate synchronously
// ============================================================

describe('spawn-time SpawnError', () => {
  it.each([
    {
      fn: 'prompt' as const,
      kind: 'binary_missing' as const,
      message: 'claude binary not found',
      atom: 'UNAVAILABLE',
    },
    {
      fn: 'command' as const,
      kind: 'binary_missing' as const,
      message: 'claude binary not found',
      atom: 'UNAVAILABLE',
    },
    {
      fn: 'prompt' as const,
      kind: 'spawn_failed' as const,
      message: 'Failed to spawn claude binary: Unknown spawn error',
      atom: 'UNAVAILABLE',
    },
    {
      fn: 'skill' as const,
      kind: 'spawn_failed' as const,
      message: 'Failed to spawn claude binary: test error',
      atom: 'UNAVAILABLE',
    },
    {
      fn: 'prompt' as const,
      kind: 'binary_eacces' as const,
      message: 'Permission denied: claude',
      atom: 'FORBIDDEN',
    },
    {
      fn: 'command' as const,
      kind: 'binary_eacces' as const,
      message: 'Permission denied: claude',
      atom: 'FORBIDDEN',
    },
  ])(
    'invalidates $fn() with #$atom for $kind',
    async ({ fn, kind, message, atom }) => {
      await mockSpawnThrows(
        new SpawnError(kind, message, { binary_path: 'claude' })
      );
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      expectInvalidThrow(
        () => extValue(ext)[fn].fn(argsFor(fn), ctx),
        atom,
        message
      );
    }
  );
});

// ============================================================
// Exit-promise rejections resolve the stream to an invalid value
// ============================================================

describe('exit-promise SpawnError', () => {
  it.each([
    { fn: 'prompt' as const, timeoutMs: 5000 },
    { fn: 'skill' as const, timeoutMs: 10000 },
    { fn: 'command' as const, timeoutMs: 15000 },
  ])(
    'resolves $fn() stream to invalid #TIMEOUT after cli_timeout of $timeoutMs ms',
    async ({ fn, timeoutMs }) => {
      await mockExitRejects(
        new SpawnError(
          'cli_timeout',
          `Claude CLI timeout after ${timeoutMs}ms`,
          { timeout_ms: timeoutMs }
        )
      );
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext)[fn].fn(argsFor(fn), ctx);
      await collectChunks(stream);
      const result = await resolveStream(stream);

      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('TIMEOUT');
    }
  );

  it.each([
    { fn: 'prompt' as const, exitCode: 1 },
    { fn: 'prompt' as const, exitCode: 127 },
    { fn: 'skill' as const, exitCode: 2 },
    { fn: 'command' as const, exitCode: 3 },
  ])(
    'yields an error chunk and resolves $fn() to invalid #UNAVAILABLE for exit code $exitCode',
    async ({ fn, exitCode }) => {
      const message = `Claude CLI exited with code ${exitCode}`;
      await mockExitRejects(
        new SpawnError('exit_nonzero', message, { exit_code: exitCode })
      );
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = extValue(ext)[fn].fn(argsFor(fn), ctx);
      const chunks = await collectChunks(stream);

      const errorChunks = chunks.filter((c) => c.startsWith('[error]'));
      expect(errorChunks.length).toBeGreaterThan(0);
      expect(errorChunks[0]).toContain(message);

      const result = await resolveStream(stream);
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('UNAVAILABLE');
    }
  );
});
