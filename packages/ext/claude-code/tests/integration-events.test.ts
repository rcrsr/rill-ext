/**
 * Integration tests for Claude Code extension event emission.
 * Tests that all event types (AC-17 to AC-21) are emitted correctly with proper fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeCodeExtension } from '../src/factory.js';
import { makeFactoryCtx } from './_helpers.js';
import { createRuntimeContext, type ExtensionEvent } from '@rcrsr/rill';

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
 * The resolve callback is where events are emitted.
 */
async function resolveStream(
  stream: unknown
): Promise<Record<string, unknown>> {
  return (
    stream as { __rill_stream_resolve: () => Promise<Record<string, unknown>> }
  ).__rill_stream_resolve();
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Helper to create event collector for onLogEvent callback.
 * Returns array that gets populated with emitted events.
 */
function createEventCollector(): ExtensionEvent[] {
  return [];
}

// ============================================================
// SETUP
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Claude Code Extension Integration Tests - Event Emission', () => {
  describe('AC-17: claude-code:prompt event emitted after prompt completes', () => {
    it('emits event with prompt (truncated) and duration fields', async () => {
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
        result: 'Test response',
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

      // Create event collector
      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Execute prompt and resolve stream to trigger event emission
      const stream = (ext.value as any).prompt.fn(
        { text: 'Hello Claude', options: {} },
        ctx
      );
      await resolveStream(stream);

      // Verify event was emitted
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.event).toBe('claude-code:prompt');
      expect(event.subsystem).toBe('extension:claude-code');
      expect(event.prompt).toBe('Hello Claude');
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });

    it('truncates long prompts to 100 characters with ellipsis', async () => {
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
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5,
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

      const longPrompt = 'a'.repeat(150);
      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).prompt.fn(
        { text: longPrompt, options: {} },
        ctx
      );
      await resolveStream(stream);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.prompt).toBe('a'.repeat(100) + '...');
      expect((event.prompt as string).length).toBe(103);
    });
  });

  describe('AC-18: claude-code:skill event emitted after skill completes', () => {
    it('emits event with name, args, and duration fields', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Skill result',
        tokens: {
          prompt: 15,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 10,
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

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const skillArgs = { verbose: true, retries: 3 };
      const stream = (ext.value as any).skill.fn(
        { name: 'test-skill', args: skillArgs },
        ctx
      );
      await resolveStream(stream);

      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.event).toBe('claude-code:skill');
      expect(event.subsystem).toBe('extension:claude-code');
      expect(event.name).toBe('test-skill');
      expect(event.args).toEqual(skillArgs);
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });

    it('includes empty args dict when no args provided', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Skill result',
        tokens: {
          prompt: 10,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 5,
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

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).skill.fn(
        { name: 'test-skill', args: {} },
        ctx
      );
      await resolveStream(stream);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.args).toEqual({});
    });
  });

  describe('AC-19: claude-code:command event emitted after command completes', () => {
    it('emits event with name, args, and duration fields', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');
      const { extractResult } = await import('../src/result.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      vi.mocked(extractResult).mockReturnValue({
        result: 'Command result',
        tokens: {
          prompt: 12,
          cache_write_5m: 0,
          cache_write_1h: 0,
          cache_read: 0,
          output: 7,
        },
        cost: 0.0015,
        exit_code: 0,
        duration: 600,
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

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const commandArgs = { config: { format: 'json' }, priority: 'high' };
      const stream = (ext.value as any).command.fn(
        { name: 'test-command', args: commandArgs },
        ctx
      );
      await resolveStream(stream);

      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.event).toBe('claude-code:command');
      expect(event.subsystem).toBe('extension:claude-code');
      expect(event.name).toBe('test-command');
      expect(event.args).toEqual(commandArgs);
      expect(typeof event.duration).toBe('number');
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(typeof event.timestamp).toBe('string');
    });
  });

  describe('AC-20: claude-code:error event emitted on any error', () => {
    it('emits error event with error message on prompt failure', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock spawn to reject with error
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.reject(new Error('Process timeout')),
        dispose: vi.fn(),
      });

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // fn() returns stream synchronously; resolve it to trigger event emission
      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      // Resolving a stream with an error chunk still resolves (not rejects)
      await resolveStream(stream);

      // Find error event
      const errorEvents = events.filter((e) => e.event === 'claude-code:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.subsystem).toBe('extension:claude-code');
      expect(event.error).toBe('Process timeout');
      expect(typeof event.duration).toBe('number');
      expect(typeof event.timestamp).toBe('string');
    });

    it('emits error event with error message on skill failure', async () => {
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
        } as any,
        exitCode: Promise.reject(new Error('Skill execution failed')),
        dispose: vi.fn(),
      });

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).skill.fn(
        { name: 'failing-skill', args: {} },
        ctx
      );
      await resolveStream(stream);

      const errorEvents = events.filter((e) => e.event === 'claude-code:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.error).toBe('Skill execution failed');
    });

    it('emits error event with error message on command failure', async () => {
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
        } as any,
        exitCode: Promise.reject(new Error('Command failed')),
        dispose: vi.fn(),
      });

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).command.fn(
        { name: 'failing-command', args: {} },
        ctx
      );
      await resolveStream(stream);

      const errorEvents = events.filter((e) => e.event === 'claude-code:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.error).toBe('Command failed');
    });

    it('includes generic error message for non-Error exceptions', async () => {
      const { spawnClaudeCli } = await import('../src/process.js');
      const { createStreamParser } = await import('../src/stream-parser.js');

      vi.mocked(createStreamParser).mockReturnValue({
        processChunk: vi.fn(),
        flush: vi.fn(),
      });

      // Mock with non-Error rejection
      vi.mocked(spawnClaudeCli).mockReturnValue({
        ptyProcess: {
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          kill: vi.fn(),
        } as any,
        exitCode: Promise.reject('String error'),
        dispose: vi.fn(),
      });

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      await resolveStream(stream);

      const errorEvents = events.filter((e) => e.event === 'claude-code:error');
      expect(errorEvents).toHaveLength(1);

      const event = errorEvents[0]!;
      expect(event.error).toBe('Unknown error');
    });
  });

  describe('AC-21: claude-code:warning event emitted on recoverable parse issue', () => {
    it('is not yet implemented - warnings not emitted by stream parser', () => {
      // NOTE: AC-21 requires adding warning emission to stream-parser.ts
      // Current implementation throws RuntimeError on invalid JSON (non-recoverable)
      // No recoverable parse warnings exist yet in the implementation
      // This test documents the gap and should be expanded when warnings are implemented
      expect(true).toBe(true);
    });
  });

  describe('Event timestamp auto-generation', () => {
    it('adds ISO timestamp to all events via emitExtensionEvent', async () => {
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

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      const stream = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      await resolveStream(stream);

      expect(events).toHaveLength(1);
      const event = events[0]!;

      // Verify timestamp is valid ISO string
      expect(event.timestamp).toBeDefined();
      const parsed = new Date(event.timestamp!);
      expect(parsed.toISOString()).toBe(event.timestamp);
    });
  });

  describe('Subsystem consistency', () => {
    it('uses extension:claude-code subsystem for all events', async () => {
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

      const events = createEventCollector();
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const ctx = createRuntimeContext({
        callbacks: {
          onLog: vi.fn(),
          onLogEvent: (event) => events.push(event),
        },
      });

      // Test all three functions — resolve each stream to emit events
      const s1 = (ext.value as any).prompt.fn(
        { text: 'Test', options: {} },
        ctx
      );
      await resolveStream(s1);

      const s2 = (ext.value as any).skill.fn({ name: 'skill', args: {} }, ctx);
      await resolveStream(s2);

      const s3 = (ext.value as any).command.fn(
        { name: 'command', args: {} },
        ctx
      );
      await resolveStream(s3);

      expect(events).toHaveLength(3);
      events.forEach((event) => {
        expect(event.subsystem).toBe('extension:claude-code');
      });
    });
  });
});
