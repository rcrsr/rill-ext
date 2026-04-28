/**
 * Factory tests for Tavily search extension.
 * Validates config validation, factory shape, and dispose lifecycle.
 * Covers: AC-1, AC-14, AC-34, AC-35, EC-13.
 */

import { describe, it, expect } from 'vitest';
import {
  RuntimeError,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
} from '@rcrsr/rill';
import { createTavilyExtension } from '../src/factory.js';

function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

describe('createTavilyExtension', () => {
  describe('configuration validation', () => {
    it('throws config atom for missing apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createTavilyExtension({ apiKey: undefined as unknown as string }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws config atom for empty apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createTavilyExtension({ apiKey: '' }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws config atom for invalid baseUrl (non-http)', () => {
      let caught: unknown;
      try {
        createTavilyExtension(
          { apiKey: 'test-key', baseUrl: 'ftp://bad.example.com' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });

    it('accepts valid config with apiKey only [AC-1]', () => {
      expect(() =>
        createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx())
      ).not.toThrow();
    });

    it('accepts valid config with https baseUrl override [AC-1]', () => {
      expect(() =>
        createTavilyExtension(
          { apiKey: 'tvly-test-key', baseUrl: 'https://custom.tavily.com' },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });

    it('accepts valid config with http baseUrl override [AC-1]', () => {
      expect(() =>
        createTavilyExtension(
          { apiKey: 'tvly-test-key', baseUrl: 'http://localhost:8080' },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });

    it('accepts valid config with timeout [AC-1]', () => {
      expect(() =>
        createTavilyExtension(
          { apiKey: 'tvly-test-key', timeout: 15000 },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });
  });

  describe('factory shape [AC-1]', () => {
    it('returns value and dispose', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
    });

    it('returns both host functions', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      expect(getCallable(ext, 'search')).toBeDefined();
      expect(getCallable(ext, 'extract')).toBeDefined();
    });

    it('each host function has a callable fn', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      for (const name of ['search', 'extract']) {
        expect(typeof getCallable(ext, name).fn).toBe('function');
      }
    });

    it('each host function has params array', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      for (const name of ['search', 'extract']) {
        expect(Array.isArray(getCallable(ext, name).params)).toBe(true);
      }
    });

    it('dispose is a function', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      expect(typeof ext.dispose).toBe('function');
    });

    it('search has query (string) param and options (dict) param', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      const search = getCallable(ext, 'search');
      expect(search.params[0]).toMatchObject({ name: 'query', type: { kind: 'string' } });
      expect(search.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });

    it('extract has urls (tuple) param and options (dict) param', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      const extract = getCallable(ext, 'extract');
      expect(extract.params[0]).toMatchObject({ name: 'urls', type: { kind: 'tuple' } });
      expect(extract.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });
  });

  describe('dispose lifecycle', () => {
    it('dispose with no in-flight requests resolves [AC-34]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose twice is idempotent [AC-35]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose three times does not throw [AC-35]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' }, makeFactoryCtx());
      await ext.dispose!();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('does not register custom atoms (reuses rill core generics)', () => {
      const calls: Array<[string, string]> = [];
      const ctx: ExtensionFactoryCtx = {
        signal: new AbortController().signal,
        registerErrorCode: (name, kind) => calls.push([name, kind]),
      };
      createTavilyExtension({ apiKey: 'tvly-test-key' }, ctx);
      expect(calls).toEqual([]);
    });
  });
});
