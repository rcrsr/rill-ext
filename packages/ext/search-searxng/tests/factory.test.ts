/**
 * Factory tests for SearXNG search extension.
 * Validates config validation, async factory shape, probe behavior, and dispose lifecycle.
 * Covers: AC-1, AC-10, AC-15, AC-29, AC-30, AC-34, AC-35, EC-13, EC-14, EC-15, EC-16.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RuntimeError,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
} from '@rcrsr/rill';
import { createSearxngExtension } from '../src/factory.js';

function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Build a fetch mock that returns a JSON response with given status. */
function mockFetchJson(
  status: number,
  body: unknown
): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

/** Build a probe-success mock that returns { formats: ['html', 'json'] }. */
function mockProbeSuccess(): ReturnType<typeof vi.fn> {
  return mockFetchJson(200, { formats: ['html', 'json'] });
}

// ============================================================
// TESTS
// ============================================================

describe('createSearxngExtension', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // Configuration validation (sync errors — before probe)
  // ============================================================

  describe('configuration validation', () => {
    it('throws RILL-R001 for missing baseUrl [EC-13, AC-15]', async () => {
      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: undefined as unknown as string },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('baseUrl is required');
    });

    it('throws RILL-R001 for empty baseUrl [EC-13, AC-15]', async () => {
      let caught: unknown;
      try {
        await createSearxngExtension({ baseUrl: '' }, makeFactoryCtx());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('baseUrl is required');
    });

    it('throws RILL-R001 for invalid baseUrl format [EC-14]', async () => {
      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'ftp://bad.example.com' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'baseUrl must start with http'
      );
    });

    it('throws RILL-R001 for non-URL baseUrl [EC-14]', async () => {
      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'not-a-url' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });
  });

  // ============================================================
  // Factory probe — init failures (async errors during probe)
  // ============================================================

  describe('factory probe failures', () => {
    it('throws RILL-R001 when JSON not in formats array [EC-15, AC-29]', async () => {
      globalThis.fetch = mockFetchJson(200, { formats: ['html', 'csv'] });

      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'JSON format is not enabled on http://localhost:8888'
      );
    });

    it('throws RILL-R001 when formats array is absent [EC-15, AC-29]', async () => {
      globalThis.fetch = mockFetchJson(200, { engines: [] });

      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'JSON format is not enabled on http://localhost:8888'
      );
    });

    it('throws RILL-R001 when probe returns non-JSON [EC-15, AC-29]', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi
          .fn()
          .mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
      });

      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'JSON format is not enabled on http://localhost:8888'
      );
    });

    it('throws RILL-R001 when instance is unreachable (TypeError) [EC-16, AC-30]', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'instance unreachable at http://localhost:8888'
      );
    });

    it('throws RILL-R001 when probe returns non-OK status [EC-16, AC-30]', async () => {
      globalThis.fetch = mockFetchJson(503, {});

      let caught: unknown;
      try {
        await createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain(
        'instance unreachable at http://localhost:8888'
      );
    });
  });

  // ============================================================
  // Successful factory creation [AC-1, AC-10]
  // ============================================================

  describe('factory shape [AC-1, AC-10]', () => {
    it('creates extension on JSON-enabled instance [AC-1, AC-10]', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      expect(ext).toBeDefined();
    });

    it('returns value and dispose', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      expect(ext).toHaveProperty('value');
      expect(ext).toHaveProperty('dispose');
    });

    it('returns both host functions', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      expect(getCallable(ext, 'search')).toBeDefined();
      expect(getCallable(ext, 'config')).toBeDefined();
    });

    it('each host function has a callable fn', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      for (const name of ['search', 'config']) {
        expect(typeof getCallable(ext, name).fn).toBe('function');
      }
    });

    it('each host function has params array', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      for (const name of ['search', 'config']) {
        expect(Array.isArray(getCallable(ext, name).params)).toBe(true);
      }
    });

    it('dispose is a function', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      expect(typeof ext.dispose).toBe('function');
    });

    it('search has query (string) param and options (dict) param', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      const search = getCallable(ext, 'search');
      expect(search.params[0]).toMatchObject({
        name: 'query',
        type: { kind: 'string' },
      });
      expect(search.params[1]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });

    it('config has no params', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      const config = getCallable(ext, 'config');
      expect(config.params.length).toBe(0);
    });

    it('accepts http baseUrl [AC-1]', async () => {
      globalThis.fetch = mockProbeSuccess();
      await expect(
        createSearxngExtension(
          { baseUrl: 'http://localhost:8888' },
          makeFactoryCtx()
        )
      ).resolves.toBeDefined();
    });

    it('accepts https baseUrl [AC-1]', async () => {
      globalThis.fetch = mockProbeSuccess();
      await expect(
        createSearxngExtension(
          { baseUrl: 'https://searxng.example.com' },
          makeFactoryCtx()
        )
      ).resolves.toBeDefined();
    });

    it('accepts valid config with timeout [AC-1]', async () => {
      globalThis.fetch = mockProbeSuccess();
      await expect(
        createSearxngExtension(
          { baseUrl: 'http://localhost:8888', timeout: 10000 },
          makeFactoryCtx()
        )
      ).resolves.toBeDefined();
    });
  });

  // ============================================================
  // Dispose lifecycle
  // ============================================================

  describe('dispose lifecycle', () => {
    it('dispose with no in-flight requests resolves [AC-34]', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose twice is idempotent [AC-35]', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose three times does not throw [AC-35]', async () => {
      globalThis.fetch = mockProbeSuccess();
      const ext = await createSearxngExtension(
        { baseUrl: 'http://localhost:8888' },
        makeFactoryCtx()
      );
      await ext.dispose!();
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });
  });
});
