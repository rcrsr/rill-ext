/**
 * Tests for exec extension factory.
 *
 * Verifies factory creation, dynamic function generation, config defaults, and dispose.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { isInvalid } from '@rcrsr/rill';
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

    it('aborts in-flight processes and returns invalid aborted', async () => {
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
      expect(invalidateSpy).toHaveBeenCalledOnce();
      expect(invalidateSpy.mock.calls[0]![1].raw).toMatchObject({
        kind: 'aborted',
      });
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
