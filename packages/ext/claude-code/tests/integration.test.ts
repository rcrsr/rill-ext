/**
 * Integration tests for Claude Code extension success cases.
 * Tests extension factory and result structure with mocked stream parser and result extractor.
 */

import { describe, it, expect, vi } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { SpawnError } from '../src/errors.js';
import { makeFactoryCtx, expectInvalidThrow } from './_helpers.js';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  isRillStream,
  type RillValue,
} from '@rcrsr/rill';
import type { ClaudeCodeResult } from '../src/types.js';

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
async function resolveStream(
  stream: unknown
): Promise<Record<string, unknown>> {
  return (
    stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }
  ).__rill_stream_resolve();
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

describe('Claude Code Extension Integration Tests - Success Cases', () => {
  // AC-10: prompt() returns RillStream
  describe('AC-10: prompt/skill/command return RillStream', () => {
    it('prompt() returns RillStream (isRillStream is true)', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );

      expect(isRillStream(stream)).toBe(true);
    });

    it('skill() returns RillStream (isRillStream is true)', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Skill done',
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).skill.fn(
        { name: 'test-skill', args: {} },
        ctx
      );

      expect(isRillStream(stream)).toBe(true);
    });

    it('command() returns RillStream (isRillStream is true)', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Command done',
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).command.fn(
        { name: 'test-command', args: {} },
        ctx
      );

      expect(isRillStream(stream)).toBe(true);
    });
  });

  // AC-11: Iterating Claude Code streams yields string stdout line chunks
  describe('AC-11: Iterating stream yields string stdout line chunks', () => {
    it('yields string chunks when PTY emits data lines', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
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
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn((cb) => {
            onExitCallback = cb;
          }),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
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
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );

      expect(isRillStream(stream)).toBe(true);

      const chunks = await collectChunks(stream);

      // All collected chunks must be strings (AC-11)
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => typeof c === 'string')).toBe(true);
    });
  });

  // AC-12: Claude Code stream resolution dict contains result, tokens, cost, exit_code, duration
  describe('AC-12: Stream resolution dict contains required fields', () => {
    it('resolves with result, tokens, cost, exit_code, duration', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });
      vi.mocked(extractResult).mockReturnValue({
        result: 'Hello! How can I help?',
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );
      const result = (await resolveStream(stream)) as Record<string, unknown>;

      // AC-12: Verify all required resolution fields are present
      expect(result['result']).toBe('Hello! How can I help?');
      expect(result['cost']).toBe(0.001);
      expect(result['exit_code']).toBe(0);
      expect(result['duration']).toBe(1200);
      expect(result['tokens']).toBeDefined();
    });
  });

  describe('AC-1: Basic prompt returns result dict with text, tokens, cost, exit_code 0', () => {
    it('returns complete ClaudeCodeResult structure via stream resolve', async () => {
      // Import mocked modules
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      // Setup mocks
      const mockParser = {
        processChunk: vi.fn(),
        flush: vi.fn(),
      };

      vi.mocked(createStreamParser).mockReturnValue(mockParser);

      vi.mocked(extractResult).mockReturnValue({
        result: 'Hello! How can I help?',
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      // Create extension and execute
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );

      // AC-10: verify it's a stream
      expect(isRillStream(stream)).toBe(true);

      // AC-12: resolve and verify result structure
      const result = (await resolveStream(stream)) as ClaudeCodeResult;

      expect(result.result).toBe('Hello! How can I help?');
      expect(result.tokens.prompt).toBe(10);
      expect(result.tokens.output).toBe(8);
      expect(result.cost).toBe(0.001);
      expect(result.exit_code).toBe(0);
      expect(result.duration).toBe(1200);
    });
  });

  describe('AC-2: Skill with args passes serialized flags, returns result', () => {
    it('serializes boolean and nested dict args correctly', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).skill.fn(
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

      const result = (await resolveStream(stream)) as Record<string, unknown>;
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
        processChunk: vi.fn(),
        flush: vi.fn(),
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension(
        { defaultTimeout: 1800000 },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
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
        processChunk: vi.fn(),
        flush: vi.fn(),
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension(
        { defaultTimeout: 45000 },
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
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

  describe('AC-4: Token tracking extracts full breakdown from usage events', () => {
    it('returns 5-field token breakdown from extractResult', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock extractResult with all 5 token fields (AC-4)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 20,
          cache_write_5m: 5,
          cache_write_1h: 8,
          cache_read: 3,
          output: 10,
        },
        cost: 0.002,
        exit_code: 0,
        duration: 1000,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      const result = (await resolveStream(stream)) as ClaudeCodeResult;

      // Verify all 5 token fields present
      expect(result.tokens.prompt).toBe(20);
      expect(result.tokens.cache_write_5m).toBe(5);
      expect(result.tokens.cache_write_1h).toBe(8);
      expect(result.tokens.cache_read).toBe(3);
      expect(result.tokens.output).toBe(10);
    });
  });

  describe('AC-5: Cost extraction reads cost_usd from CLI ResultMessage', () => {
    it('extracts cost field from result', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with specific cost value (AC-5)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 5,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 3,
        },
        cost: 0.00456,
        exit_code: 0,
        duration: 800,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      const result = (await resolveStream(stream)) as ClaudeCodeResult;

      // Verify exact cost extraction
      expect(result.cost).toBe(0.00456);
    });
  });

  describe('AC-12: Empty result returns empty string in result field', () => {
    it('returns empty string when extractResult provides empty text', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with empty result string (AC-12)
      vi.mocked(extractResult).mockReturnValue({
        result: '',
        tokens: {
          prompt: 0,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 0,
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
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      const result = (await resolveStream(stream)) as ClaudeCodeResult;

      // Verify empty string
      expect(result.result).toBe('');
    });
  });

  describe('AC-13: Zero tokens returns all-zero TokenCounts', () => {
    it('returns zero values for all token fields', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with all-zero tokens (AC-13)
      vi.mocked(extractResult).mockReturnValue({
        result: 'Response',
        tokens: {
          prompt: 0,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 0,
        },
        cost: 0.0,
        exit_code: 0,
        duration: 500,
      });

      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.resolve(0),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      const result = (await resolveStream(stream)) as ClaudeCodeResult;

      // Verify all zeros
      expect(result.tokens.prompt).toBe(0);
      expect(result.tokens.cache_write_5m).toBe(0);
      expect(result.tokens.cache_write_1h).toBe(0);
      expect(result.tokens.cache_read).toBe(0);
      expect(result.tokens.output).toBe(0);
    });
  });
});

// ============================================================
// ERROR CONTRACT TESTS
// ============================================================

describe('Claude Code Extension Integration Tests - Error Contracts', () => {
  // EC-7: Empty prompt/name text invalidates with #INVALID_INPUT before stream creation
  describe('EC-7: Empty text invalidates with #INVALID_INPUT before stream creation', () => {
    it('prompt() invalidates for empty prompt text', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).prompt.fn({ text: '', options: {} }, ctx),
        'INVALID_INPUT',
        'prompt text cannot be empty'
      );
    });

    it('prompt() invalidates for whitespace-only prompt text', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).prompt.fn({ text: '   ', options: {} }, ctx),
        'INVALID_INPUT',
        'prompt text cannot be empty'
      );
    });

    it('skill() invalidates for empty skill name', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).skill.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'skill name cannot be empty'
      );
    });

    it('skill() invalidates for whitespace-only skill name', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).skill.fn({ name: '  ', args: {} }, ctx),
        'INVALID_INPUT',
        'skill name cannot be empty'
      );
    });

    it('command() invalidates for empty command name', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).command.fn({ name: '', args: {} }, ctx),
        'INVALID_INPUT',
        'command name cannot be empty'
      );
    });

    it('command() invalidates for whitespace-only command name', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();
      expectInvalidThrow(
        () => (ext.value as any).command.fn({ name: '\t', args: {} }, ctx),
        'INVALID_INPUT',
        'command name cannot be empty'
      );
    });
  });

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
          (ext.value as any).prompt.fn(
            { text: 'Hello Claude', options: {} },
            ctx
          ),
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
        exit_code: 0,
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
          new SpawnError('cli_timeout', 'Claude CLI timeout after 5000ms', {
            timeoutMs: 5000,
          })
        ),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
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
        processChunk: vi.fn(),
        flush: vi.fn(),
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
          onData: vi.fn((cb) => {
            onDataCallback = cb;
          }),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: new Promise<number>((_, reject) => {
          setTimeout(() => {
            if (onDataCallback) {
              onDataCallback('partial output line\n');
            }
            reject(exitError);
          }, 5);
        }),
        dispose: vi.fn(),
      });

      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const stream = (ext.value as any).prompt.fn(
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
        () => (ext.value as any).prompt.fn({ text: 'Hello', options: {} }, ctx),
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
        () =>
          (ext.value as any).skill.fn({ name: 'test-skill', args: {} }, ctx),
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
        () =>
          (ext.value as any).command.fn(
            { name: 'test-command', args: {} },
            ctx
          ),
        'UNAVAILABLE',
        'Failed to spawn claude binary'
      );
    });
  });

  // ============================================================
  // BOUNDARY CONDITION TESTS
  // ============================================================

  describe('boundary conditions', () => {
    // AC-13: resolveStream(prompt()) returns dict identical to pre-streaming return
    describe('AC-13: resolveStream(prompt()) returns expected dict shape field-by-field', () => {
      it('resolution dict contains all required fields with correct types', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn(),
          flush: vi.fn(),
        });
        vi.mocked(extractResult).mockReturnValue({
          result: 'Task completed successfully.',
          tokens: {
            prompt: 12,
            cache_write_5m: 0,
            cache_write_1h: 0,
            cache_read: 5,
            output: 9,
          },
          cost: 0.0025,
          exit_code: 0,
          duration: 950,
        });
        vi.mocked(spawnClaudeCli).mockReturnValue({
          ptyProcess: {
            onData: vi.fn(),
            onExit: vi.fn(),
            write: vi.fn(),
            kill: vi.fn(),
          } as any,
          exitCode: Promise.resolve(0),
          dispose: vi.fn(),
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = (ext.value as any).prompt.fn(
          { text: 'Do something', options: {} },
          ctx
        );
        const result = await resolveStream(stream);

        // All required Claude Code resolution dict fields (IR-6 / spec)
        expect(typeof result['result']).toBe('string');
        expect(result['result']).toBe('Task completed successfully.');
        expect(result['tokens']).toBeDefined();
        expect(typeof result['cost']).toBe('number');
        expect(result['cost']).toBe(0.0025);
        expect(typeof result['exit_code']).toBe('number');
        expect(result['exit_code']).toBe(0);
        expect(typeof result['duration']).toBe('number');
        expect(result['duration']).toBe(950);
      });
    });

    // AC-22: Second iteration of a consumed Claude Code stream throws RILL-R002
    describe('AC-22: second iteration of consumed Claude Code stream throws RILL-R002', () => {
      it('calling next() on consumed stream root step throws RILL-R002', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        let onDataCb: ((chunk: string) => void) | undefined;
        let onExitCb: ((event: { exitCode: number }) => void) | undefined;

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn(),
          flush: vi.fn(),
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
            onData: vi.fn((cb) => {
              onDataCb = cb;
            }),
            onExit: vi.fn((cb) => {
              onExitCb = cb;
            }),
            write: vi.fn(),
            kill: vi.fn(),
          } as any,
          exitCode: new Promise<number>((resolve) => {
            setTimeout(() => {
              if (onDataCb) onDataCb('output line\n');
              if (onExitCb) onExitCb({ exitCode: 0 });
              resolve(0);
            }, 5);
          }),
          dispose: vi.fn(),
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = (ext.value as any).prompt.fn(
          { text: 'Test', options: {} },
          ctx
        );

        // Navigate manually to the done step (replicates collectChunks but keeps the done step)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = stream;
        while (!current.done) {
          current = await (current.next as any).fn({}, null);
        }

        // Re-iterating the done step throws RILL-R002 synchronously
        // (the done step's callable is a sync function that throws, not async)
        expect(() => (current.next as any).fn({}, null)).toThrow(
          expect.objectContaining({
            errorId: 'RILL-R002',
            message: 'Stream already consumed; cannot re-iterate',
          })
        );
      });
    });

    // AC-24: Stream with 0 data chunks resolves to valid dict
    describe('AC-24: 0-chunk stream resolves to valid Claude Code dict', () => {
      it('stream that emits no PTY data still resolves with valid dict shape', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

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
          exit_code: 0,
          duration: 0,
        });

        // PTY exits immediately without emitting any data
        vi.mocked(spawnClaudeCli).mockReturnValue({
          ptyProcess: {
            onData: vi.fn(),
            onExit: vi.fn(),
            write: vi.fn(),
            kill: vi.fn(),
          } as any,
          exitCode: Promise.resolve(0),
          dispose: vi.fn(),
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = (ext.value as any).prompt.fn(
          { text: 'Empty task', options: {} },
          ctx
        );
        const result = await resolveStream(stream);

        // Resolution dict must be valid even with 0 data chunks
        expect(typeof result['result']).toBe('string');
        expect(result['tokens']).toBeDefined();
        expect(typeof result['cost']).toBe('number');
        expect(typeof result['exit_code']).toBe('number');
        expect(typeof result['duration']).toBe('number');
      });
    });

    // AC-27: Abandoned Claude Code stream triggers dispose cleanup
    describe('AC-27: abandoned Claude Code stream triggers dispose callback', () => {
      it('calling __rill_stream_dispose invokes spawn cleanup', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        const mockDispose = vi.fn();

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn(),
          flush: vi.fn(),
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
          } as any,
          exitCode: new Promise(() => {
            /* never resolves — simulates abandoned stream */
          }),
          dispose: mockDispose,
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = (ext.value as any).prompt.fn(
          { text: 'Long task', options: {} },
          ctx
        );

        // Simulate abandonment: invoke the hidden dispose property
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const disposeStream = (stream as any).__rill_stream_dispose;
        expect(typeof disposeStream).toBe('function');

        disposeStream();

        // The dispose callback on the stream calls spawn.dispose()
        expect(mockDispose).toHaveBeenCalledTimes(1);
      });

      it('dispose is idempotent: calling twice invokes spawn.dispose() only once', async () => {
        const { spawnClaudeCli } = await import('../src/process.js');
        const { createStreamParser } = await import('../src/stream-parser.js');
        const { extractResult } = await import('../src/result.js');

        const mockDispose = vi.fn();

        vi.mocked(createStreamParser).mockReturnValue({
          processChunk: vi.fn(),
          flush: vi.fn(),
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
          } as any,
          exitCode: new Promise(() => {
            /* never resolves */
          }),
          dispose: mockDispose,
        });

        const ext = createClaudeCodeExtension({}, makeFactoryCtx());
        const ctx = createRuntimeContext();

        const stream = (ext.value as any).prompt.fn(
          { text: 'Long task', options: {} },
          ctx
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const disposeStream = (stream as any).__rill_stream_dispose;

        disposeStream();
        disposeStream();

        // createRillStream wraps dispose to be idempotent — spawn.dispose() called once
        expect(mockDispose).toHaveBeenCalledTimes(1);
      });
    });
  });
});
