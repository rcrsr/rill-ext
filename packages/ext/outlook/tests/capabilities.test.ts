/**
 * Capability gate tests for Outlook extension.
 * Verifies each capability flag blocks its controlled functions when disabled
 * and folder allowlist enforcement.
 *
 * Capability and folder denials surface as invalid `RillValue`s carrying
 * `#FORBIDDEN` (post-rill-0.19); host-level dispatch resolves rather than
 * throws.
 *
 * Covers: AC-21, AC-22, EC-2, EC-4, EC-5, EC-7, EC-10.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type RillValue,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createOutlookExtension } from '../src/factory.js';
import { checkCapability, checkFolder } from '../src/capabilities.js';
import type { OutlookConfig } from '../src/types.js';

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function configWith(
  overrides: Partial<{
    mailRead: boolean;
    mailSend: boolean;
    mailDraft: boolean;
    mailFlag: boolean;
    mailSearch: boolean;
    calRead: boolean;
    calCreate: boolean;
  }>
): OutlookConfig {
  return {
    auth: { type: 'bearer', token: 'test-token' },
    capabilities: {
      mail: {
        read: overrides.mailRead ?? true,
        send: overrides.mailSend ?? false,
        draft: overrides.mailDraft ?? true,
        flag: overrides.mailFlag ?? true,
        search: overrides.mailSearch ?? true,
      },
      calendar: {
        read: overrides.calRead ?? true,
        create: overrides.calCreate ?? false,
      },
    },
  };
}

function expectInvalid(result: unknown, atom: string, msg?: string): void {
  const v = result as RillValue;
  expect(isInvalid(v)).toBe(true);
  expect(getStatus(v).code.name).toBe(atom);
  if (msg !== undefined) expect(getStatus(v).message).toBe(msg);
}

async function expectForbidden(
  promise: RillValue | Promise<RillValue>,
  msg: string
): Promise<void> {
  const result = await promise;
  expectInvalid(result, 'FORBIDDEN', msg);
}

describe('capability gates', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // checkCapability unit tests
  // ============================================================

  describe('checkCapability', () => {
    it('does not throw when enabled is true', () => {
      const ctx = createRuntimeContext();
      expect(() => checkCapability(ctx, true, 'mail.read')).not.toThrow();
    });

    it('throws an invalid RillValue (#FORBIDDEN) when disabled', () => {
      const ctx = createRuntimeContext();
      let caught: unknown;
      try {
        checkCapability(ctx, false, 'mail.read');
      } catch (e) {
        caught = e;
      }
      expectInvalid(caught, 'FORBIDDEN', 'outlook: mail.read not enabled');
    });
  });

  // ============================================================
  // checkFolder unit tests
  // ============================================================

  describe('checkFolder', () => {
    it('does not throw when folder is in allowlist', () => {
      const ctx = createRuntimeContext();
      expect(() => checkFolder(ctx, ['inbox', 'sent'], 'inbox')).not.toThrow();
    });

    it('throws an invalid RillValue (#FORBIDDEN) when not in allowlist', () => {
      const ctx = createRuntimeContext();
      let caught: unknown;
      try {
        checkFolder(ctx, ['inbox'], 'drafts');
      } catch (e) {
        caught = e;
      }
      expectInvalid(
        caught,
        'FORBIDDEN',
        "outlook: folder 'drafts' not accessible"
      );
    });

    it('is case-sensitive — inbox does not match Inbox', () => {
      const ctx = createRuntimeContext();
      let caught: unknown;
      try {
        checkFolder(ctx, ['inbox'], 'Inbox');
      } catch (e) {
        caught = e;
      }
      expect(isInvalid(caught as RillValue)).toBe(true);
    });

    it('allows multiple folders in allowlist', () => {
      const ctx = createRuntimeContext();
      expect(() =>
        checkFolder(ctx, ['inbox', 'sent', 'drafts'], 'sent')
      ).not.toThrow();
    });
  });

  // ============================================================
  // disabled capability gates
  // ============================================================
  describe('disabled capability', () => {
    const cases: {
      name: string;
      overrides: Parameters<typeof configWith>[0];
      fn: string;
      args: Record<string, RillValue>;
      message: string;
    }[] = [
      {
        name: 'mail.read',
        overrides: { mailRead: false },
        fn: 'inbox',
        args: { top: 10 },
        message: 'outlook: mail.read not enabled',
      },
      {
        name: 'mail.read',
        overrides: { mailRead: false },
        fn: 'from',
        args: { address: 'test@example.com' },
        message: 'outlook: mail.read not enabled',
      },
      {
        name: 'mail.read',
        overrides: { mailRead: false },
        fn: 'search',
        args: { query: 'hello' },
        message: 'outlook: mail.read not enabled',
      },
      {
        name: 'mail.read',
        overrides: { mailRead: false },
        fn: 'read',
        args: { message_id: 'msg-1' },
        message: 'outlook: mail.read not enabled',
      },
      {
        name: 'mail.send',
        overrides: { mailSend: false },
        fn: 'send',
        args: { to: ['r@example.com'], subject: 's', body: 'b' },
        message: 'outlook: mail.send not enabled',
      },
      {
        name: 'mail.send',
        overrides: { mailSend: false },
        fn: 'reply',
        args: { message_id: 'm', body: 'b' },
        message: 'outlook: mail.send not enabled',
      },
      {
        name: 'mail.draft',
        overrides: { mailDraft: false },
        fn: 'draft',
        args: { to: ['r@example.com'], subject: 's', body: 'b' },
        message: 'outlook: mail.draft not enabled',
      },
      {
        name: 'mail.flag',
        overrides: { mailFlag: false },
        fn: 'flag',
        args: { message_id: 'm' },
        message: 'outlook: mail.flag not enabled',
      },
      {
        name: 'mail.search',
        overrides: { mailSearch: false },
        fn: 'search',
        args: { query: 'test' },
        message: 'outlook: mail.search not enabled',
      },
      {
        name: 'calendar.read',
        overrides: { calRead: false },
        fn: 'events',
        args: { start: 0, end: 1000 },
        message: 'outlook: calendar.read not enabled',
      },
      {
        name: 'calendar.read',
        overrides: { calRead: false },
        fn: 'today',
        args: {},
        message: 'outlook: calendar.read not enabled',
      },
      {
        name: 'calendar.read',
        overrides: { calRead: false },
        fn: 'free_busy',
        args: { start: 0, end: 1000, attendees: ['a@example.com'] },
        message: 'outlook: calendar.read not enabled',
      },
      {
        name: 'calendar.create',
        overrides: { calCreate: false },
        fn: 'create_event',
        args: { title: 'Meeting', start: 0, end: 1000 },
        message: 'outlook: calendar.create not enabled',
      },
    ];

    it.each(cases)(
      'emits #FORBIDDEN for $fn when $name is disabled',
      async ({ overrides, fn, args, message }) => {
        const ext = createOutlookExtension(
          configWith(overrides),
          makeFactoryCtx()
        );
        const ctx = createRuntimeContext();
        await expectForbidden(getCallable(ext, fn).fn(args, ctx), message);
      }
    );
  });

  describe('capability gate ordering', () => {
    it('fires the mail.read check before any fetch call', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension(
        configWith({ mailRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
