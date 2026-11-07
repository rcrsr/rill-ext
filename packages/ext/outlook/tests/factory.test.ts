/**
 * Factory tests for Outlook extension.
 * Validates config validation, factory shape, default capabilities, and dispose lifecycle.
 * Covers: EC-1, AC-1, AC-15, AC-20, AC-29, AC-30, AC-36, AC-38, EC-13.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RuntimeError,
  createRuntimeContext,
  type ApplicationCallable,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createOutlookExtension } from '../src/factory.js';
import type { OutlookConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

async function expectNotInvalid(
  result: RillValue | Promise<RillValue>
): Promise<void> {
  const value = await result;
  expect(isInvalid(value)).toBe(false);
}

const BEARER_CONFIG: OutlookConfig = {
  auth: { type: 'bearer', token: 'test-token' },
};

const MAX_RESULTS_MESSAGE = 'outlook: maxResults must be 1-1000';

const INVALID_CONFIGS: {
  title: string;
  config: OutlookConfig;
  message: string;
}[] = [
  {
    title: 'when auth is missing',
    config: { auth: undefined as unknown as OutlookConfig['auth'] },
    message: 'outlook: auth is required',
  },
  {
    title: 'for invalid auth.type',
    config: { auth: { type: 'oauth' as unknown as 'bearer', token: 'tok' } },
    message: "outlook: auth.type must be 'bearer' or 'session'",
  },
  {
    title: 'for empty bearer token',
    config: { auth: { type: 'bearer', token: '' } },
    message: 'outlook: auth.token is required',
  },
  {
    title: 'for empty session tokenVar',
    config: { auth: { type: 'session', tokenVar: '' } },
    message: 'outlook: auth.tokenVar is required',
  },
  {
    title: 'when session tokenVar is missing',
    config: {
      auth: { type: 'session', tokenVar: undefined as unknown as string },
    },
    message: 'outlook: auth.tokenVar is required',
  },
  {
    title: 'when maxResults is 0',
    config: { auth: { type: 'bearer', token: 'tok' }, mail: { maxResults: 0 } },
    message: MAX_RESULTS_MESSAGE,
  },
  {
    title: 'when maxResults is 1001',
    config: {
      auth: { type: 'bearer', token: 'tok' },
      mail: { maxResults: 1001 },
    },
    message: MAX_RESULTS_MESSAGE,
  },
  {
    title: 'when maxResults is negative',
    config: {
      auth: { type: 'bearer', token: 'tok' },
      mail: { maxResults: -5 },
    },
    message: MAX_RESULTS_MESSAGE,
  },
  {
    title: 'when folders array is empty',
    config: { auth: { type: 'bearer', token: 'tok' }, mail: { folders: [] } },
    message: 'outlook: folders must be non-empty',
  },
];

const POST_DISPOSE_CASES: { fn: string; args: Record<string, RillValue> }[] = [
  { fn: 'inbox', args: { top: 10 } },
  { fn: 'from', args: { address: 'a@b.com' } },
  { fn: 'search', args: { query: 'q' } },
  { fn: 'read', args: { message_id: 'm1' } },
  { fn: 'send', args: { to: ['a@b.com'], subject: 'Hi', body: 'Hello' } },
  { fn: 'draft', args: { to: ['a@b.com'], subject: 'Hi', body: 'Hello' } },
  { fn: 'reply', args: { message_id: 'm1', body: 'Hello' } },
  { fn: 'flag', args: { message_id: 'm1' } },
  { fn: 'events', args: { start: 0, end: 1000 } },
  { fn: 'today', args: {} },
  { fn: 'free_busy', args: { start: 0, end: 1000, attendees: ['a@b.com'] } },
  {
    fn: 'create_event',
    args: { title: 'T', start: 0, end: 1000, options: {} },
  },
];

async function captureThrown(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  return undefined;
}

// ============================================================
// TESTS
// ============================================================

describe('createOutlookExtension', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // Configuration validation
  // ============================================================

  describe('configuration validation', () => {
    it.each(INVALID_CONFIGS)(
      'throws RILL-R001 $title',
      ({ config, message }) => {
        let caught: unknown;
        try {
          createOutlookExtension(config, makeFactoryCtx());
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(RuntimeError);
        expect((caught as RuntimeError).errorId).toBe('RILL-R001');
        expect((caught as RuntimeError).message).toBe(message);
      }
    );

    it('accepts whitespace-only bearer token at config time', () => {
      // The config validation only checks !token or token === ''
      // A whitespace-only token passes config validation (resolved to the token string)
      // This test documents the current behavior: whitespace is accepted at config time
      expect(() =>
        createOutlookExtension(
          { auth: { type: 'bearer', token: '   ' } },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });

    it('accepts maxResults at boundary 1', () => {
      expect(() =>
        createOutlookExtension(
          {
            auth: { type: 'bearer', token: 'tok' },
            mail: { maxResults: 1 },
          },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });

    it('accepts maxResults at boundary 1000', () => {
      expect(() =>
        createOutlookExtension(
          {
            auth: { type: 'bearer', token: 'tok' },
            mail: { maxResults: 1000 },
          },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });

    it('accepts bearer config with token', () => {
      expect(() =>
        createOutlookExtension(BEARER_CONFIG, makeFactoryCtx())
      ).not.toThrow();
    });

    it('accepts session config with tokenVar', () => {
      expect(() =>
        createOutlookExtension(
          { auth: { type: 'session', tokenVar: 'MY_TOKEN' } },
          makeFactoryCtx()
        )
      ).not.toThrow();
    });
  });

  // ============================================================
  // Factory shape
  // ============================================================

  describe('factory shape', () => {
    it('value contains exactly 12 keys', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const keys = Object.keys(ext.value as Record<string, unknown>);
      expect(keys).toHaveLength(12);
    });

    it('inbox has top (num) and unread (bool) params', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const fn = getCallable(ext, 'inbox');
      expect(fn.params[0]).toMatchObject({
        name: 'top',
        type: { kind: 'number' },
      });
      expect(fn.params[1]).toMatchObject({
        name: 'unread',
        type: { kind: 'bool' },
      });
    });

    it('from has address (str) and top (num) params', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const fn = getCallable(ext, 'from');
      expect(fn.params[0]).toMatchObject({
        name: 'address',
        type: { kind: 'string' },
      });
      expect(fn.params[1]).toMatchObject({
        name: 'top',
        type: { kind: 'number' },
      });
    });

    it('events has start (num) and end (num) params', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const fn = getCallable(ext, 'events');
      expect(fn.params[0]).toMatchObject({
        name: 'start',
        type: { kind: 'number' },
      });
      expect(fn.params[1]).toMatchObject({
        name: 'end',
        type: { kind: 'number' },
      });
    });

    it('create_event has title (str), start (num), end (num), options (dict) params', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const fn = getCallable(ext, 'create_event');
      expect(fn.params[0]).toMatchObject({
        name: 'title',
        type: { kind: 'string' },
      });
      expect(fn.params[1]).toMatchObject({
        name: 'start',
        type: { kind: 'number' },
      });
      expect(fn.params[2]).toMatchObject({
        name: 'end',
        type: { kind: 'number' },
      });
      expect(fn.params[3]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });
  });

  // ============================================================
  // Default capabilities
  // ============================================================

  describe('default capabilities', () => {
    it('mail.read defaults to true', async () => {
      // If mail.read were false, inbox would throw — it does not throw when not calling network
      // We verify by checking the factory succeeds with defaults and calling with read enabled
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      // mock fetch so we can call inbox without network
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: [] }),
      });
      const ctx = createRuntimeContext();
      await expectNotInvalid(getCallable(ext, 'inbox').fn({ top: 10 }, ctx));
    });

    it('mail.send defaults to false — send emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const result = (await getCallable(ext, 'send').fn(
        { to: ['a@b.com'], subject: 'Hi', body: 'Hello' },
        ctx
      )) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('FORBIDDEN');
      expect(getStatus(result).message).toContain('mail.send not enabled');
    });

    it('mail.draft defaults to true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({}),
      });
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      // draft is enabled by default — should not throw a capability error
      await expectNotInvalid(
        getCallable(ext, 'draft').fn(
          { to: ['a@b.com'], subject: 'Hi', body: 'Hello' },
          ctx
        )
      );
    });

    it('mail.flag defaults to true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({}),
      });
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await expectNotInvalid(
        getCallable(ext, 'flag').fn({ message_id: 'msg-1' }, ctx)
      );
    });

    it('mail.search defaults to true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: [] }),
      });
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await expectNotInvalid(
        getCallable(ext, 'search').fn({ query: 'hello' }, ctx)
      );
    });

    it('calendar.read defaults to true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ value: [] }),
      });
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      await expectNotInvalid(
        getCallable(ext, 'events').fn({ start: 0, end: 1000 }, ctx)
      );
    });

    it('calendar.create defaults to false — create_event emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const result = (await getCallable(ext, 'create_event').fn(
        { title: 'Meeting', start: 0, end: 1000, options: {} },
        ctx
      )) as RillValue;
      expect(isInvalid(result)).toBe(true);
      expect(getStatus(result).code.name).toBe('FORBIDDEN');
      expect(getStatus(result).message).toContain(
        'calendar.create not enabled'
      );
    });
  });

  // ============================================================
  // Dispose lifecycle
  // ============================================================

  describe('dispose lifecycle', () => {
    it('dispose with no in-flight requests resolves to undefined', async () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('dispose twice is idempotent — no error', async () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      await ext.dispose!();
      await expect(ext.dispose!()).resolves.toBeUndefined();
    });

    it('lists every host function in the post-dispose cases', () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      expect(POST_DISPOSE_CASES.map((c) => c.fn).sort()).toEqual(
        Object.keys(ext.value as Record<string, unknown>).sort()
      );
    });

    it.each(POST_DISPOSE_CASES)(
      'throws #DISPOSED for $fn after dispose',
      async ({ fn, args }) => {
        const fetchSpy = vi.fn<typeof fetch>();
        globalThis.fetch = fetchSpy;
        const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
        const ctx = createRuntimeContext();
        const onLogEvent = vi.fn<(event: unknown) => void>();
        ctx.callbacks.onLogEvent = onLogEvent;
        await ext.dispose!();

        const thrown = await captureThrown(() =>
          getCallable(ext, fn).fn(args, ctx)
        );

        expect(thrown).toBeDefined();
        expect(isInvalid(thrown as RillValue)).toBe(true);
        const status = getStatus(thrown as RillValue);
        expect(status.code.name).toBe('DISPOSED');
        expect(status.provider).toBe('outlook');
        expect(status.raw['kind']).toBe('extension_disposed');
        expect(status.message).toBe('outlook: operation cancelled');
        expect(onLogEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'outlook:error',
            subsystem: 'extension:outlook',
          })
        );
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    );
  });

  // ============================================================
  // Module import no side effects
  // ============================================================

  describe('passive provision', () => {
    it('makes no fetch call at import or factory time', async () => {
      const fetchSpy = vi.fn<typeof fetch>();
      globalThis.fetch = fetchSpy;

      vi.resetModules();
      const fresh = await import('../src/factory.js');
      expect(fetchSpy).not.toHaveBeenCalled();

      const ext = fresh.createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      expect(fetchSpy).not.toHaveBeenCalled();

      await ext.dispose!();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
