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
  promise: Promise<unknown>,
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

    it('includes capability name in message', () => {
      const ctx = createRuntimeContext();
      let caught: unknown;
      try {
        checkCapability(ctx, false, 'calendar.create');
      } catch (e) {
        caught = e;
      }
      expectInvalid(
        caught,
        'FORBIDDEN',
        'outlook: calendar.create not enabled'
      );
    });
  });

  // ============================================================
  // checkFolder unit tests [EC-4, AC-22]
  // ============================================================

  describe('checkFolder [EC-4, AC-22]', () => {
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

    it('throws with exact folder name in message', () => {
      const ctx = createRuntimeContext();
      let caught: unknown;
      try {
        checkFolder(ctx, ['inbox'], 'SentItems');
      } catch (e) {
        caught = e;
      }
      expectInvalid(
        caught,
        'FORBIDDEN',
        "outlook: folder 'SentItems' not accessible"
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
  // mail.read capability [EC-2, AC-21]
  // ============================================================

  describe('mail.read disabled [EC-2, AC-21]', () => {
    it('inbox emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'inbox').fn({ top: 10 }, ctx),
        'outlook: mail.read not enabled'
      );
    });

    it('from emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'from').fn({ address: 'test@example.com' }, ctx),
        'outlook: mail.read not enabled'
      );
    });

    it('search emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'search').fn({ query: 'hello' }, ctx),
        'outlook: mail.read not enabled'
      );
    });

    it('read emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'read').fn({ message_id: 'msg-1' }, ctx),
        'outlook: mail.read not enabled'
      );
    });

    it('capability check fires before any fetch call', async () => {
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

  describe('mail.send disabled [EC-5, AC-21]', () => {
    it('send emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailSend: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'send').fn(
          { to: ['r@example.com'], subject: 's', body: 'b' },
          ctx
        ),
        'outlook: mail.send not enabled'
      );
    });

    it('reply emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailSend: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'reply').fn({ message_id: 'm', body: 'b' }, ctx),
        'outlook: mail.send not enabled'
      );
    });
  });

  describe('mail.draft disabled [EC-7, AC-21]', () => {
    it('draft emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailDraft: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'draft').fn(
          { to: ['r@example.com'], subject: 's', body: 'b' },
          ctx
        ),
        'outlook: mail.draft not enabled'
      );
    });
  });

  describe('mail.flag disabled [EC-7, AC-21]', () => {
    it('flag emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ mailFlag: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'flag').fn({ message_id: 'm' }, ctx),
        'outlook: mail.flag not enabled'
      );
    });
  });

  describe('mail.search disabled [EC-7, AC-21]', () => {
    it('search emits #FORBIDDEN with mail.search-specific message', async () => {
      const ext = createOutlookExtension(
        configWith({ mailSearch: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'search').fn({ query: 'test' }, ctx),
        'outlook: mail.search not enabled'
      );
    });
  });

  describe('calendar.read disabled [EC-7, AC-21]', () => {
    it('events emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ calRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'events').fn({ start: 0, end: 1000 }, ctx),
        'outlook: calendar.read not enabled'
      );
    });

    it('today emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ calRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'today').fn({}, ctx),
        'outlook: calendar.read not enabled'
      );
    });

    it('free_busy emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ calRead: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'free_busy').fn(
          { start: 0, end: 1000, attendees: ['a@example.com'] },
          ctx
        ),
        'outlook: calendar.read not enabled'
      );
    });
  });

  describe('calendar.create disabled [EC-10, AC-21]', () => {
    it('create_event emits #FORBIDDEN', async () => {
      const ext = createOutlookExtension(
        configWith({ calCreate: false }),
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();
      await expectForbidden(
        getCallable(ext, 'create_event').fn(
          { title: 'Meeting', start: 0, end: 1000 },
          ctx
        ),
        'outlook: calendar.create not enabled'
      );
    });
  });
});
