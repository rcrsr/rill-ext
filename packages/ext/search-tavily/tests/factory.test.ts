/**
 * Factory tests for Tavily search extension.
 * Validates config validation, factory shape, and dispose lifecycle.
 * Covers: AC-1, AC-14, AC-34, AC-35, EC-13.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError, type ApplicationCallable } from '@rcrsr/rill';
import { createTavilyExtension } from '../src/factory.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// TESTS
// ============================================================

describe('createTavilyExtension', () => {
  describe('configuration validation', () => {
    it('throws RILL-R004 for missing apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createTavilyExtension({ apiKey: undefined as unknown as string });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws RILL-R004 for empty apiKey [EC-13, AC-14]', () => {
      let caught: unknown;
      try {
        createTavilyExtension({ apiKey: '' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws RILL-R004 for invalid baseUrl (non-http)', () => {
      let caught: unknown;
      try {
        createTavilyExtension({ apiKey: 'test-key', baseUrl: 'ftp://bad.example.com' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('accepts valid config with apiKey only [AC-1]', () => {
      expect(() =>
        createTavilyExtension({ apiKey: 'tvly-test-key' })
      ).not.toThrow();
    });

    it('accepts valid config with https baseUrl override [AC-1]', () => {
      expect(() =>
        createTavilyExtension({
          apiKey: 'tvly-test-key',
          baseUrl: 'https://custom.tavily.com',
        })
      ).not.toThrow();
    });

    it('accepts valid config with http baseUrl override [AC-1]', () => {
      expect(() =>
        createTavilyExtension({
          apiKey: 'tvly-test-key',
          baseUrl: 'http://localhost:8080',
        })
      ).not.toThrow();
    });

    it('accepts valid config with timeout [AC-1]', () => {
      expect(() =>
        createTavilyExtension({
          apiKey: 'tvly-test-key',
          timeout: 15000,
        })
      ).not.toThrow();
    });
  });

  describe('factory shape [AC-1]', () => {
    it('returns value and dispose', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
    });

    it('returns both host functions', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      expect(getCallable(ext, 'search')).toBeDefined();
      expect(getCallable(ext, 'extract')).toBeDefined();
    });

    it('each host function has a callable fn', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      for (const name of ['search', 'extract']) {
        expect(typeof getCallable(ext, name).fn).toBe('function');
      }
    });

    it('each host function has params array', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      for (const name of ['search', 'extract']) {
        expect(Array.isArray(getCallable(ext, name).params)).toBe(true);
      }
    });

    it('dispose is a function', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      expect(typeof ext.dispose).toBe('function');
    });

    it('search has query (string) param and options (dict) param', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      const search = getCallable(ext, 'search');
      expect(search.params[0]).toMatchObject({ name: 'query', type: { kind: 'string' } });
      expect(search.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });

    it('extract has urls (tuple) param and options (dict) param', () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      const extract = getCallable(ext, 'extract');
      expect(extract.params[0]).toMatchObject({ name: 'urls', type: { kind: 'tuple' } });
      expect(extract.params[1]).toMatchObject({ name: 'options', type: { kind: 'dict' } });
    });
  });

  describe('dispose lifecycle', () => {
    it('dispose with no in-flight requests resolves [AC-34]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose twice is idempotent [AC-35]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose three times does not throw [AC-35]', async () => {
      const ext = createTavilyExtension({ apiKey: 'tvly-test-key' });
      await ext.dispose!();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });
  });
});
