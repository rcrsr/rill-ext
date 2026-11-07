/**
 * Factory skeleton tests for Google Workspace extension.
 * Covers: AC-1 (17 callables + dispose), AC-5 (dispose aborts),
 *         AC-6 (call after dispose), AC-7 (idempotent dispose),
 *         AC-4 (capability gate), BC-5 (concurrent call during dispose).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RuntimeError,
  createRuntimeContext,
  type ApplicationCallable,
  type ExtensionFactoryResult,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createGoogleWorkspaceExtension } from '../src/factory.js';

// ============================================================
// HELPERS
// ============================================================

async function disposeExt(ext: ExtensionFactoryResult): Promise<void> {
  if (ext.dispose === undefined) {
    throw new Error('extension result has no dispose');
  }
  await ext.dispose();
}

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// FIXTURES
// ============================================================

/** Minimal bearer-auth config — all default capabilities. */
const BEARER_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
};

/** Config with all capabilities explicitly enabled. */
const ALL_CAPS_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    gmail: {
      read: true,
      search: true,
      send: true,
      draft: true,
      reply: true,
      label: true,
      modify: true,
    },
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
    calendar: {
      read: true,
      create: true,
      update: true,
      delete: true,
      freeBusy: true,
    },
  },
};

/** All 17 expected callable names. */
const EXPECTED_CALLABLE_NAMES = [
  'gmail_search',
  'gmail_read',
  'gmail_send',
  'gmail_draft',
  'gmail_reply',
  'gmail_flag',
  'gmail_label',
  'drive_list',
  'drive_upload',
  'drive_download',
  'drive_share',
  'drive_delete',
  'drive_get_metadata',
  'calendar_events',
  'calendar_today',
  'calendar_create_event',
  'calendar_free_busy',
] as const;

// ============================================================
// AC-1: 17 callables + dispose returned
// ============================================================

describe('createGoogleWorkspaceExtension', () => {
  describe('AC-1: returns ExtensionFactoryResult with all 17 callables and dispose', () => {
    it('value contains exactly the 17 callable names', () => {
      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      const keys = Object.keys(ext.value as Record<string, unknown>);
      expect(keys.sort()).toEqual([...EXPECTED_CALLABLE_NAMES].sort());
    });
  });

  // ============================================================
  // AC-3: params array entries are valid RillParam shapes from p.* helpers
  // ============================================================

  describe('AC-3: each callable params array contains valid RillParam objects', () => {
    it('gmail_search first param is named "query" with string type', () => {
      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      const callable = (ext.value as Record<string, ApplicationCallable>)[
        'gmail_search'
      ]!;
      const firstParam = callable.params[0]!;

      expect(firstParam.name).toBe('query');
      expect((firstParam.type as { kind: string }).kind).toBe('string');
    });

    it('calendar_free_busy first param is named "emails" with list type', () => {
      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      const callable = (ext.value as Record<string, ApplicationCallable>)[
        'calendar_free_busy'
      ]!;
      const firstParam = callable.params[0]!;

      expect(firstParam.name).toBe('emails');
      expect((firstParam.type as { kind: string }).kind).toBe('list');
    });
  });

  // ============================================================
  // AC-6: Call after dispose → operation cancelled
  // ============================================================

  describe('AC-6: call after dispose throws "operation cancelled"', () => {
    it('emits #DISPOSED "google: operation cancelled" when disposed', async () => {
      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await disposeExt(ext);
      const caught = (await getCallable(ext, 'gmail_search').fn(
        { query: 'hello' },
        ctx
      )) as RillValue;
      expect(isInvalid(caught)).toBe(true);
      expect(getStatus(caught).code.name).toBe('DISPOSED');
      expect(getStatus(caught).message).toBe('google: operation cancelled');
    });

    it('all 17 callables emit #DISPOSED after dispose', async () => {
      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await disposeExt(ext);
      for (const name of EXPECTED_CALLABLE_NAMES) {
        const caught = (await getCallable(ext, name).fn({}, ctx)) as RillValue;
        expect(isInvalid(caught)).toBe(true);
        expect(getStatus(caught).code.name).toBe('DISPOSED');
        expect(getStatus(caught).message).toBe('google: operation cancelled');
      }
    });
  });

  // ============================================================
  // AC-7: Idempotent dispose
  // ============================================================

  describe('AC-7: dispose is idempotent', () => {
    it('second dispose call returns without throwing', async () => {
      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      await disposeExt(ext);
      // Second call must not throw
      await expect(disposeExt(ext)).resolves.toBeUndefined();
    });

    it('third dispose call also succeeds', async () => {
      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      await disposeExt(ext);
      await disposeExt(ext);
      await expect(disposeExt(ext)).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // BC-5 / EC-20: Concurrent in-flight abort during dispose
  // ============================================================

  describe('BC-5 + EC-20: concurrent in-flight calls during dispose', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('in-flight call resolves to #DISPOSED when dispose fires mid-flight (BC-5)', async () => {
      // Arrange: mock fetch to hang until its AbortSignal fires.
      globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              );
              return;
            }
            signal.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              );
            });
          }
        });
      }) as unknown as typeof fetch;

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      // Act: start a call (suspends at the hanging fetch) but do not await
      const inflight = getCallable(ext, 'gmail_search').fn(
        { query: 'test query' },
        ctx
      );

      // Yield microtasks so the call advances past resolveToken and into fetch
      await Promise.resolve();
      await Promise.resolve();

      // Dispose while the call is in-flight: sets isDisposed=true and aborts controllers
      await disposeExt(ext);

      // Assert: the in-flight call resolves to an invalid #DISPOSED RillValue
      const result = (await inflight) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('DISPOSED');
      expect(getStatus(result).message).toBe('google: operation cancelled');
    });

    it('multiple concurrent in-flight calls all resolve to #DISPOSED on dispose (BC-5)', async () => {
      // Arrange: same hanging fetch mock
      globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              );
              return;
            }
            signal.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError')
              );
            });
          }
        });
      }) as unknown as typeof fetch;

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      // Start 3 concurrent calls without awaiting
      const calls = [
        getCallable(ext, 'gmail_search').fn({ query: 'query-1' }, ctx),
        getCallable(ext, 'gmail_search').fn({ query: 'query-2' }, ctx),
        getCallable(ext, 'gmail_search').fn({ query: 'query-3' }, ctx),
      ];

      // Yield so all three advance past resolveToken and into fetch
      await Promise.resolve();
      await Promise.resolve();

      // Dispose aborts all three in-flight controllers
      await disposeExt(ext);

      // All three resolve to invalid #DISPOSED RillValues (aborted by dispose)
      const results = await Promise.allSettled(calls);
      for (const result of results) {
        expect(result.status).toBe('fulfilled');
        if (result.status === 'fulfilled') {
          const value = result.value as RillValue;
          expect(isInvalid(value)).toBe(true);
          expect(getStatus(value).code.name).toBe('DISPOSED');
        }
      }
    });
  });

  // ============================================================
  // AC-10: Token cache cleared on dispose
  // ============================================================

  describe('AC-10: calls after a successful call and dispose', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('emits #DISPOSED without calling fetch again after a prior successful call', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      ) as unknown as typeof fetch;

      const ext = createGoogleWorkspaceExtension(
        BEARER_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'gmail_search').fn(
        { query: 'before-dispose' },
        ctx
      );

      await expect(disposeExt(ext)).resolves.toBeUndefined();

      const caught = (await getCallable(ext, 'gmail_search').fn(
        { query: 'after-dispose' },
        ctx
      )) as RillValue;
      expect(isInvalid(caught)).toBe(true);
      expect(getStatus(caught).code.name).toBe('DISPOSED');
      expect(getStatus(caught).message).toBe('google: operation cancelled');

      // Only the pre-dispose call reached fetch
      expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(1);
    });
  });

  // ============================================================
  // Factory validation pass-through
  // ============================================================

  describe('factory validation', () => {
    it('throws RILL-R001 when auth token is empty', () => {
      let caught: unknown;
      try {
        createGoogleWorkspaceExtension(
          {
            auth: { type: 'bearer', token: '' },
          },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });

    it('succeeds with valid bearer config', () => {
      expect(() =>
        createGoogleWorkspaceExtension(BEARER_CONFIG, makeFactoryCtx())
      ).not.toThrow();
    });
  });
});
