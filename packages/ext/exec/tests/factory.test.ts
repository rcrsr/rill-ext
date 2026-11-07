/**
 * Tests for exec extension factory.
 *
 * Verifies factory creation, dynamic function generation, config defaults, and dispose.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRuntimeContext,
  execute,
  getStatus,
  isInvalid,
  parse,
  RuntimeHaltSignal,
  type RuntimeContext,
} from '@rcrsr/rill';
import { createExecExtension } from '../src/factory.js';
import type { ExecExtensionConfig } from '../src/types.js';
import { getCallable, makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

describe('exec extension factory', () => {
  describe('factory creation', () => {
    it('wraps each command as ApplicationCallable', () => {
      const config: ExecExtensionConfig = {
        commands: { echo: { binary: 'echo' } },
      };

      const ext = createExecExtension(config, makeFactoryCtx());
      const callable = getCallable(ext, 'echo');

      expect(callable).toMatchObject({
        __type: 'callable',
        kind: 'application',
        params: expect.any(Array),
        fn: expect.any(Function),
        annotations: expect.objectContaining({
          description: expect.any(String),
        }),
        returnType: expect.objectContaining({ __rill_type: true }),
      });
    });
  });

  describe('RillFunction structure', () => {
    it('includes params with default values', () => {
      const ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );

      expect(getCallable(ext, 'echo').params).toEqual([
        {
          name: 'args',
          type: { kind: 'list' },
          defaultValue: [],
          annotations: { description: 'Command arguments' },
        },
        {
          name: 'stdin',
          type: { kind: 'string' },
          defaultValue: undefined,
          annotations: { description: 'Standard input data' },
        },
      ]);
    });

    it('includes description from config', () => {
      const ext = createExecExtension(
        {
          commands: {
            git: { binary: 'git', description: 'Git version control' },
          },
        },
        makeFactoryCtx()
      );

      expect(getCallable(ext, 'git').annotations?.['description']).toBe(
        'Git version control'
      );
    });

    it('generates default description when not provided', () => {
      const ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );

      expect(getCallable(ext, 'echo').annotations?.['description']).toBe(
        'Execute echo command'
      );
    });

    it('declares returnType as dict with stdout, stderr and exit_code fields', () => {
      const ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );

      expect(getCallable(ext, 'echo').returnType).toMatchObject({
        __rill_type: true,
        structure: {
          kind: 'dict',
          fields: {
            stdout: { type: { kind: 'string' } },
            stderr: { type: { kind: 'string' } },
            exit_code: { type: { kind: 'number' } },
          },
        },
      });
    });
  });

  describe('commands() introspection', () => {
    it('returns list of command dicts', async () => {
      const ext = createExecExtension(
        {
          commands: {
            git: { binary: 'git', description: 'Git VCS' },
            npm: { binary: 'npm', description: 'Node package manager' },
          },
        },
        makeFactoryCtx()
      );

      const result = await getCallable(ext, 'commands').fn(
        {},
        makeRuntimeCtx()
      );

      expect(result).toEqual([
        { name: 'git', description: 'Git VCS' },
        { name: 'npm', description: 'Node package manager' },
      ]);
    });

    it('returns empty description for commands without description', async () => {
      const ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );

      const result = await getCallable(ext, 'commands').fn(
        {},
        makeRuntimeCtx()
      );
      expect(result).toEqual([{ name: 'echo', description: '' }]);
    });

    it('returns empty list when no commands configured', async () => {
      const ext = createExecExtension({ commands: {} }, makeFactoryCtx());
      const result = await getCallable(ext, 'commands').fn(
        {},
        makeRuntimeCtx()
      );
      expect(result).toEqual([]);
    });
  });

  describe('dispose()', () => {
    let ext: ReturnType<typeof createExecExtension>;

    afterEach(async () => {
      if (ext?.dispose) await ext.dispose();
    });

    it('aborts in-flight processes and returns invalid DISPOSED', async () => {
      ext = createExecExtension(
        {
          commands: { sleep: { binary: 'sleep', timeout: 10000 } },
        },
        makeFactoryCtx()
      );
      const ctx = makeRuntimeCtx();
      const invalidateSpy = vi.spyOn(ctx, 'invalidate');

      const start = Date.now();
      const promise = getCallable(ext, 'sleep').fn({ args: ['5'] }, ctx);
      await ext.dispose!();
      const result = await promise;

      expect(Date.now() - start).toBeLessThan(2000);
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('DISPOSED');
      expect(invalidateSpy.mock.calls.at(-1)![1].raw).toMatchObject({
        kind: 'extension_disposed',
      });
    });

    it('throws DISPOSED from every function after dispose without spawning', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'exec-disposed-'));
      const marker = join(dir, 'marker');
      try {
        ext = createExecExtension(
          {
            commands: { touch: { binary: 'touch' }, echo: { binary: 'echo' } },
          },
          makeFactoryCtx()
        );
        const names = Object.keys(ext.value as Record<string, unknown>);
        expect(names.sort()).toEqual(['commands', 'echo', 'touch']);
        await ext.dispose!();
        await ext.dispose!();

        for (const name of names) {
          let thrown: unknown;
          let resolved = false;
          try {
            await getCallable(ext, name).fn(
              name === 'touch' ? { args: [marker] } : {},
              makeRuntimeCtx()
            );
            resolved = true;
          } catch (e) {
            thrown = e;
          }
          expect(resolved).toBe(false);
          expect(thrown).toBeInstanceOf(RuntimeHaltSignal);
          expect((thrown as RuntimeHaltSignal).catchable).toBe(true);
          const invalid = (thrown as RuntimeHaltSignal).value;
          expect(isInvalid(invalid)).toBe(true);
          const status = getStatus(invalid);
          expect(status.code.name).toBe('DISPOSED');
          expect(status.raw['kind']).toBe('extension_disposed');
          expect(status.provider).toBe('exec');
        }
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('disposes cleanly with no in-flight processes', async () => {
      ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('factory-scope signal aborts in-flight child processes', async () => {
      const controller = new AbortController();
      ext = createExecExtension(
        { commands: { sleep: { binary: 'sleep', timeout: 10000 } } },
        makeFactoryCtx(controller.signal)
      );
      const ctx = makeRuntimeCtx();
      const invalidateSpy = vi.spyOn(ctx, 'invalidate');

      const start = Date.now();
      const promise = getCallable(ext, 'sleep').fn({ args: ['5'] }, ctx);
      controller.abort();
      const result = await promise;

      expect(Date.now() - start).toBeLessThan(2000);
      expect(isInvalid(result)).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledOnce();
      expect(invalidateSpy.mock.calls[0]![1].raw).toMatchObject({
        kind: 'aborted',
      });
    });
  });
});

describe('exec extension - runtime dispatch after dispose', () => {
  async function mountDisposed(): Promise<RuntimeContext> {
    const ext = createExecExtension(
      { commands: { echo: { binary: 'echo' } } },
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext({
      functions: { commands: getCallable(ext, 'commands') },
    });
    await ext.dispose?.();
    return ctx;
  }

  it('rejects a script call with a catchable DISPOSED halt', async () => {
    const ctx = await mountDisposed();

    const thrown = await execute(parse('commands()'), ctx).catch(
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
      parse('guard<on: list[#DISPOSED]> { commands() }'),
      ctx
    );

    expect(getStatus(result.result).code.name).toBe('DISPOSED');
  });
});
