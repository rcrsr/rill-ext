/**
 * Tests for createClaudeCodeExtension factory.
 * Covers config validation, function stubs, and cleanup lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  getStatus,
  isInvalid,
  structureToTypeValue,
  RuntimeHaltSignal,
  createRuntimeContext,
  execute,
  parse,
  type ApplicationCallable,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createClaudeCodeExtension } from '../src/factory.js';
import { PROVIDER } from '../src/errors.js';
import { spawnClaudeCli } from '../src/process.js';
import {
  makeFactoryCtx,
  makeRuntimeCtx,
  expectInvalidThrow,
  extValue,
} from './_helpers.js';

const EXPECTED_RETURN_TYPE = structureToTypeValue({
  kind: 'stream',
  chunk: { kind: 'string' },
  ret: {
    kind: 'dict',
    fields: {
      result: { type: { kind: 'string' } },
      tokens: {
        type: {
          kind: 'dict',
          fields: {
            prompt: { type: { kind: 'number' } },
            cache_write_5m: { type: { kind: 'number' } },
            cache_write_1h: { type: { kind: 'number' } },
            cache_read: { type: { kind: 'number' } },
            output: { type: { kind: 'number' } },
          },
        },
      },
      cost: { type: { kind: 'number' } },
      exit_code: { type: { kind: 'number' } },
      duration: { type: { kind: 'number' } },
    },
  },
});

// Mock which module
vi.mock('which', () => ({
  default: {
    sync: vi.fn((path: string) => {
      if (path === 'claude' || path === '/usr/bin/claude') {
        return path;
      }
      const error = new Error('not found') as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    }),
  },
}));

// Mock process module to avoid node-pty dependency
vi.mock('../src/process.js', () => ({
  spawnClaudeCli: vi.fn(),
}));

describe('createClaudeCodeExtension', () => {
  describe('factory return value', () => {
    it('creates prompt function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.prompt.params).toEqual([
        {
          name: 'text',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'options',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.prompt.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates skill function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.skill.params).toEqual([
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'args',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.skill.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });

    it('creates command function with correct parameter signature', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      const v = extValue(ext);

      expect(v.command.params).toEqual([
        {
          name: 'name',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: {},
        },
        {
          name: 'args',
          type: {
            kind: 'dict',
            fields: { timeout: { type: { kind: 'number' }, defaultValue: 0 } },
          },
          defaultValue: {},
          annotations: {},
        },
      ]);
      expect(v.command.returnType).toEqual(EXPECTED_RETURN_TYPE);
    });
  });

  describe('binaryPath validation (EC-1)', () => {
    it('throws RuntimeError RILL-R001 for invalid binaryPath', () => {
      expect(() =>
        createClaudeCodeExtension(
          { binaryPath: '/nonexistent/claude' },
          makeFactoryCtx()
        )
      ).toThrow('claude binary not found');
    });
  });

  describe('timeout validation', () => {
    it.each([
      { label: 'negative', timeout: -1 },
      { label: 'negative large', timeout: -5000 },
      { label: 'zero', timeout: 0 },
      { label: 'decimal', timeout: 2500.75 },
      { label: 'fractional millisecond', timeout: 10000.1 },
      { label: 'just above max', timeout: 3600001 },
      { label: 'far above max', timeout: 5000000 },
    ])('throws for $label timeout $timeout', ({ timeout }) => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: timeout }, makeFactoryCtx())
      ).toThrow('Invalid timeout: must be positive integer, max 3600000');
    });

    it.each([
      { label: 'lower boundary', timeout: 1 },
      { label: 'upper boundary', timeout: 3600000 },
    ])('accepts $label timeout $timeout', ({ timeout }) => {
      expect(() =>
        createClaudeCodeExtension({ defaultTimeout: timeout }, makeFactoryCtx())
      ).not.toThrow();
    });
  });

  describe('dispose function', () => {
    it('dispose is idempotent (multiple calls safe)', async () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // Should not throw on multiple calls
      await expect(
        (async (): Promise<void> => {
          await ext.dispose?.();
          await ext.dispose?.();
          await ext.dispose?.();
        })()
      ).resolves.toBeUndefined();
    });

    it('dispose completes successfully on clean instance', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      expect(() => ext.dispose?.()).not.toThrow();
    });
  });

  describe('post-dispose calls', () => {
    const ARGS_BY_NAME: Record<string, Record<string, RillValue>> = {
      prompt: { text: 'hello', options: {} },
      skill: { name: 'review', args: {} },
      command: { name: 'build', args: {} },
    };

    async function captureThrown(
      fn: (args: Record<string, RillValue>, ctx: never) => unknown,
      args: Record<string, RillValue>
    ): Promise<{ resolved: boolean; thrown: unknown }> {
      try {
        await fn(args, makeRuntimeCtx() as never);
        return { resolved: true, thrown: undefined };
      } catch (e) {
        return { resolved: false, thrown: e };
      }
    }

    async function expectDisposedThrows(
      ext: ReturnType<typeof createClaudeCodeExtension>
    ): Promise<void> {
      const names = Object.keys(ext.value as Record<string, unknown>);
      expect(names.sort()).toEqual(Object.keys(ARGS_BY_NAME).sort());
      const v = extValue(ext) as unknown as Record<
        string,
        { fn: (a: Record<string, RillValue>, c: never) => unknown }
      >;
      for (const name of names) {
        const { resolved, thrown } = await captureThrown(
          v[name]!.fn,
          ARGS_BY_NAME[name]!
        );
        expect(resolved).toBe(false);
        expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
        expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
        const invalid = (thrown as RuntimeHaltSignal).value;
        expect(isInvalid(invalid)).toBe(true);
        const status = getStatus(invalid);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.raw['kind']).toBe('extension_disposed');
        expect(status.provider).toBe(PROVIDER);
      }
    }

    beforeEach(() => {
      vi.mocked(spawnClaudeCli).mockClear();
    });

    it('throws #DISPOSED from every function after dispose', async () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      await ext.dispose?.();

      await expectDisposedThrows(ext);
      expect(spawnClaudeCli).not.toHaveBeenCalled();
    });

    it('throws #DISPOSED before validating blank text', async () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());
      await ext.dispose?.();
      const v = extValue(ext);

      const { thrown } = await captureThrown(v.prompt.fn, {
        text: '',
        options: {},
      });

      expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
      expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
      const invalid = (thrown as RuntimeHaltSignal).value;
      expect(getStatus(invalid).code.name).toBe('DISPOSED');
    });

    it('throws #DISPOSED after the factory signal aborts', async () => {
      const controller = new AbortController();
      const ext = createClaudeCodeExtension(
        {},
        { signal: controller.signal, registerErrorCode: () => {} }
      );
      controller.abort();

      await expectDisposedThrows(ext);
      expect(spawnClaudeCli).not.toHaveBeenCalled();
    });
  });

  describe('cleanup failure handling (EC-16)', () => {
    let consoleWarnSpy: MockInstance<typeof console.warn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('dispose does not throw even without processes', () => {
      const ext = createClaudeCodeExtension({}, makeFactoryCtx());

      // EC-16: Should handle empty state gracefully
      expect(() => ext.dispose?.()).not.toThrow();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('default values', () => {
    it('handles undefined config', () => {
      expect(() =>
        createClaudeCodeExtension(undefined, makeFactoryCtx())
      ).not.toThrow();
    });
  });

  describe('empty input validation', () => {
    const BLANK_INPUTS = [
      { label: 'empty string', value: '' },
      { label: 'spaces', value: '   ' },
      { label: 'tabs and newlines', value: '\t\n  ' },
    ];
    const CASES = BLANK_INPUTS.flatMap(({ label, value }) => [
      {
        fn: 'prompt' as const,
        label,
        args: { text: value, options: {} },
        message: 'prompt text cannot be empty',
      },
      {
        fn: 'skill' as const,
        label,
        args: { name: value, args: {} },
        message: 'skill name cannot be empty',
      },
      {
        fn: 'command' as const,
        label,
        args: { name: value, args: {} },
        message: 'command name cannot be empty',
      },
    ]);

    it.each(CASES)(
      'invalidates $fn with #INVALID_INPUT for $label',
      ({ fn, args, message }) => {
        const v = extValue(createClaudeCodeExtension({}, makeFactoryCtx()));
        const ctx = makeRuntimeCtx();

        expectInvalidThrow(() => v[fn].fn(args, ctx), 'INVALID_INPUT', message);
      }
    );
  });
});

describe('createClaudeCodeExtension - runtime dispatch after dispose', () => {
  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = createClaudeCodeExtension({}, makeFactoryCtx());
    const prompt = (ext.value as Record<string, ApplicationCallable>)[
      'prompt'
    ]!;
    const ctx = createRuntimeContext({
      functions: { prompt },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('prompt("hi")'), ctx).catch(
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
    const status = getStatus((thrown as RuntimeHaltSignal).value);
    expect(status.code.name).toBe('DISPOSED');
    expect(status.raw['kind']).toBe('extension_disposed');
  });

  it('completes a guarded script call with the DISPOSED invalid value', async () => {
    const ctx = await mountDisposed();

    const result = await execute(
      parse('guard<on: list[#DISPOSED]> { prompt("hi") }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
