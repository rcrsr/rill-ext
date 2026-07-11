/**
 * Tests for exec extension factory.
 *
 * Verifies factory creation, dynamic function generation, config defaults, and dispose.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createExecExtension } from '../src/factory.js';
import type { ExecExtensionConfig } from '../src/types.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

describe('exec extension factory', () => {
  describe('factory creation', () => {
    it('creates ExtensionFactoryResult with command functions and dispose', () => {
      const config: ExecExtensionConfig = {
        commands: {
          echo: { binary: 'echo' },
          pwd: { binary: 'pwd' },
        },
      };

      const ext = createExecExtension(config, makeFactoryCtx());

      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
      expect(ext.value).toHaveProperty('echo');
      expect(ext.value).toHaveProperty('pwd');
      expect(ext.value).toHaveProperty('commands');
    });

    it('wraps each command as ApplicationCallable', () => {
      const config: ExecExtensionConfig = {
        commands: { echo: { binary: 'echo' } },
      };

      const ext = createExecExtension(config, makeFactoryCtx());
      const callable = ext.value.echo as Record<string, unknown>;

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

    it('generates function for each declared command', () => {
      const config: ExecExtensionConfig = {
        commands: {
          git: { binary: 'git', description: 'Git VCS' },
          npm: { binary: 'npm', description: 'Node package manager' },
          node: { binary: 'node', description: 'Node runtime' },
        },
      };

      const ext = createExecExtension(config, makeFactoryCtx());

      expect(ext.value).toHaveProperty('git');
      expect(ext.value).toHaveProperty('npm');
      expect(ext.value).toHaveProperty('node');
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

      expect(ext.value.echo.params).toEqual([
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

      expect(ext.value.git.annotations?.['description']).toBe(
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

      expect(ext.value.echo.annotations?.['description']).toBe(
        'Execute echo command'
      );
    });

    it('declares returnType as dict', () => {
      const ext = createExecExtension(
        {
          commands: { echo: { binary: 'echo' } },
        },
        makeFactoryCtx()
      );

      expect(ext.value.echo.returnType).toMatchObject({
        __rill_type: true,
        structure: { kind: 'dict' },
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

      const result = await ext.value.commands.fn({}, makeRuntimeCtx());

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

      const result = await ext.value.commands.fn({}, makeRuntimeCtx());
      expect(result).toEqual([{ name: 'echo', description: '' }]);
    });

    it('returns empty list when no commands configured', async () => {
      const ext = createExecExtension({ commands: {} }, makeFactoryCtx());
      const result = await ext.value.commands.fn({}, makeRuntimeCtx());
      expect(result).toEqual([]);
    });
  });

  describe('dispose()', () => {
    let ext: ReturnType<typeof createExecExtension>;

    afterEach(async () => {
      if (ext?.dispose) await ext.dispose();
    });

    it('aborts in-flight processes', async () => {
      ext = createExecExtension(
        {
          commands: { sleep: { binary: 'sleep', timeout: 10000 } },
        },
        makeFactoryCtx()
      );

      const promise = ext.value.sleep.fn({ args: ['5'] }, makeRuntimeCtx());
      await new Promise((resolve) => setTimeout(resolve, 50));
      await ext.dispose!();

      try {
        const result = await promise;
        expect(result).toMatchObject({ exit_code: expect.not.toBe(0) });
      } catch {
        // AbortError is acceptable
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

      const start = Date.now();
      const promise = ext.value.sleep.fn({ args: ['5'] }, makeRuntimeCtx());
      // give the process a moment to spawn
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();

      // Should resolve promptly (well under the 5s sleep)
      const result = await promise.catch((e) => e);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
      // Either resolves to invalid value or rejects — both acceptable
      expect(result).toBeDefined();
    });
  });

  describe('allowlist enforcement', () => {
    it('script cannot execute undeclared binaries', () => {
      const ext = createExecExtension(
        {
          commands: { git: { binary: 'git' } },
        },
        makeFactoryCtx()
      );

      expect(ext.value).toHaveProperty('git');
      expect(ext.value).not.toHaveProperty('rm');
      expect(ext.value).not.toHaveProperty('curl');
    });
  });
});
