/**
 * Factory tests for Exa search extension.
 * Validates config validation, factory shape, and dispose lifecycle.
 * Covers: AC-1, AC-14, AC-34, AC-35, EC-13.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError, type ApplicationCallable, type ExtensionFactoryCtx } from '@rcrsr/rill';
import { createExaExtension } from '../src/factory.js';

function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// TESTS
// ============================================================

describe('createExaExtension', () => {
  describe('configuration validation', () => {
    it('throws RILL-R004 for missing apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createExaExtension({ apiKey: undefined as unknown as string }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws RILL-R004 for empty apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createExaExtension({ apiKey: '' }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws RILL-R004 for invalid baseUrl (non-http)', () => {
      let caught: unknown;
      try {
        createExaExtension({ apiKey: 'test-key', baseUrl: 'ftp://bad.example.com' }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });

    it('accepts valid config with apiKey only [AC-1]', () => {
      expect(() =>
        createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx())
      ).not.toThrow();
    });

    it('accepts valid config with https baseUrl override [AC-1]', () => {
      expect(() =>
        createExaExtension({
          apiKey: 'exa-test-key',
          baseUrl: 'https://custom.exa.ai',
        }, makeFactoryCtx())
      ).not.toThrow();
    });

    it('accepts valid config with http baseUrl override [AC-1]', () => {
      expect(() =>
        createExaExtension({
          apiKey: 'exa-test-key',
          baseUrl: 'http://localhost:8080',
        }, makeFactoryCtx())
      ).not.toThrow();
    });

    it('accepts valid config with timeout [AC-1]', () => {
      expect(() =>
        createExaExtension({
          apiKey: 'exa-test-key',
          timeout: 10000,
        }, makeFactoryCtx())
      ).not.toThrow();
    });
  });

  describe('factory shape [AC-1]', () => {
    it('returns value and dispose', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
    });

    it('returns all four host functions', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      expect(getCallable(ext, 'search')).toBeDefined();
      expect(getCallable(ext, 'contents')).toBeDefined();
      expect(getCallable(ext, 'find_similar')).toBeDefined();
      expect(getCallable(ext, 'answer')).toBeDefined();
    });

    it('each host function has a callable fn', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      for (const name of ['search', 'contents', 'find_similar', 'answer']) {
        expect(typeof getCallable(ext, name).fn).toBe('function');
      }
    });

    it('each host function has params array', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      for (const name of ['search', 'contents', 'find_similar', 'answer']) {
        expect(Array.isArray(getCallable(ext, name).params)).toBe(true);
      }
    });

    it('dispose is a function', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      expect(typeof ext.dispose).toBe('function');
    });

    it('search has query (string) param and options (dict) param', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      const search = getCallable(ext, 'search');
      expect(search.params[0]).toMatchObject({ name: 'query', type: { kind: 'string' } });
      expect(search.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });

    it('contents has urls (tuple) param and options (dict) param', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      const contents = getCallable(ext, 'contents');
      expect(contents.params[0]).toMatchObject({ name: 'urls', type: { kind: 'tuple' } });
      expect(contents.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });

    it('find_similar has url (string) param and options (dict) param', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      const findSimilar = getCallable(ext, 'find_similar');
      expect(findSimilar.params[0]).toMatchObject({ name: 'url', type: { kind: 'string' } });
      expect(findSimilar.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });

    it('answer has query (string) param and options (dict) param', () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      const answer = getCallable(ext, 'answer');
      expect(answer.params[0]).toMatchObject({ name: 'query', type: { kind: 'string' } });
      expect(answer.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });
  });

  describe('dispose lifecycle', () => {
    it('dispose with no in-flight requests resolves [AC-34]', async () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose twice is idempotent [AC-35]', async () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose three times does not throw [AC-35]', async () => {
      const ext = createExaExtension({ apiKey: 'exa-test-key' }, makeFactoryCtx());
      await ext.dispose!();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });
  });
});
