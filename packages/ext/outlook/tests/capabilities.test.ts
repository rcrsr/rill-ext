/**
 * Capability gate tests for Outlook extension.
 * Verifies each of 7 capability flags blocks its controlled functions when disabled.
 * Verifies folder allowlist enforcement.
 * Covers: AC-21, AC-22, EC-2, EC-4, EC-5, EC-7, EC-10.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createOutlookExtension } from '../src/factory.js';
import { checkCapability, checkFolder } from '../src/capabilities.js';
import type { OutlookConfig } from '../src/types.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/** Build a config with specific capabilities disabled. */
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

// ============================================================
// TESTS
// ============================================================

describe('Outlook capability gates', () => {
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
      expect(() => checkCapability(true, 'mail.read')).not.toThrow();
    });

    it('throws RILL-R004 when enabled is false', () => {
      let caught: unknown;
      try {
        checkCapability(false, 'mail.read');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: mail.read not enabled');
    });

    it('includes capability name in message', () => {
      let caught: unknown;
      try {
        checkCapability(false, 'calendar.create');
      } catch (e) {
        caught = e;
      }
      expect((caught as RuntimeError).message).toBe('outlook: calendar.create not enabled');
    });
  });

  // ============================================================
  // checkFolder unit tests [EC-4, AC-22]
  // ============================================================

  describe('checkFolder [EC-4, AC-22]', () => {
    it('does not throw when folder is in allowlist', () => {
      expect(() => checkFolder(['inbox', 'sent'], 'inbox')).not.toThrow();
    });

    it('throws RILL-R004 when folder is not in allowlist', () => {
      let caught: unknown;
      try {
        checkFolder(['inbox'], 'drafts');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe("outlook: folder 'drafts' not accessible");
    });

    it('throws with exact folder name in message', () => {
      let caught: unknown;
      try {
        checkFolder(['inbox'], 'SentItems');
      } catch (e) {
        caught = e;
      }
      expect((caught as RuntimeError).message).toBe("outlook: folder 'SentItems' not accessible");
    });

    it('is case-sensitive — inbox does not match Inbox', () => {
      let caught: unknown;
      try {
        checkFolder(['inbox'], 'Inbox');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
    });

    it('allows multiple folders in allowlist', () => {
      expect(() => checkFolder(['inbox', 'sent', 'drafts'], 'sent')).not.toThrow();
    });
  });

  // ============================================================
  // mail.read capability [EC-2, AC-21]
  // ============================================================

  describe('mail.read disabled [EC-2, AC-21]', () => {
    it('inbox throws mail.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: mail.read not enabled');
    });

    it('from throws mail.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'from').fn({ address: 'test@example.com' }, ctx)
      ).rejects.toThrow('outlook: mail.read not enabled');
    });

    it('search throws mail.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'hello' }, ctx)
      ).rejects.toThrow('outlook: mail.read not enabled');
    });

    it('read throws mail.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'read').fn({ messageId: 'msg-1' }, ctx)
      ).rejects.toThrow('outlook: mail.read not enabled');
    });

    it('capability check fires before any fetch call', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      try {
        await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
      } catch {
        // expected
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // mail.send capability [EC-5, AC-21]
  // ============================================================

  describe('mail.send disabled [EC-5, AC-21]', () => {
    it('send throws mail.send not enabled', async () => {
      // Default config: mail.send = false
      const ext = createOutlookExtension({ auth: { type: 'bearer', token: 'tok' } });
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'send').fn({ to: ['a@b.com'], subject: 'Hi', body: 'Hello' }, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: mail.send not enabled');
    });

    it('reply throws mail.send not enabled (reply shares mail.send gate)', async () => {
      const ext = createOutlookExtension({ auth: { type: 'bearer', token: 'tok' } });
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'reply').fn({ messageId: 'msg-1', body: 'Thanks' }, ctx)
      ).rejects.toThrow('outlook: mail.send not enabled');
    });

    it('send capability check fires before any fetch call', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension({ auth: { type: 'bearer', token: 'tok' } });
      const ctx = createRuntimeContext();

      try {
        await getCallable(ext, 'send').fn({ to: ['a@b.com'], subject: 'Hi', body: 'Hello' }, ctx);
      } catch {
        // expected
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // mail.draft capability [EC-5, AC-21]
  // ============================================================

  describe('mail.draft disabled [EC-5, AC-21]', () => {
    it('draft throws mail.draft not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailDraft: false }));
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'draft').fn({ to: ['a@b.com'], subject: 'Hi', body: 'Hello' }, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: mail.draft not enabled');
    });
  });

  // ============================================================
  // mail.flag capability [EC-5, AC-21]
  // ============================================================

  describe('mail.flag disabled [EC-5, AC-21]', () => {
    it('flag throws mail.flag not enabled', async () => {
      const ext = createOutlookExtension(configWith({ mailFlag: false }));
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'flag').fn({ messageId: 'msg-1' }, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: mail.flag not enabled');
    });
  });

  // ============================================================
  // mail.search capability (search shares mail.read AND mail.search) [EC-2, AC-21]
  // ============================================================

  describe('mail.search disabled [AC-21]', () => {
    it('search throws mail.search not enabled when mail.read=true but mail.search=false', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: true, mailSearch: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'search').fn({ query: 'hello' }, ctx)
      ).rejects.toThrow('outlook: mail.search not enabled');
    });
  });

  // ============================================================
  // calendar.read capability [EC-7, AC-21]
  // ============================================================

  describe('calendar.read disabled [EC-7, AC-21]', () => {
    it('events throws calendar.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ calRead: false }));
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'events').fn({ start: 0, end: 1000 }, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: calendar.read not enabled');
    });

    it('today throws calendar.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ calRead: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'today').fn({}, ctx)
      ).rejects.toThrow('outlook: calendar.read not enabled');
    });

    it('free_busy throws calendar.read not enabled', async () => {
      const ext = createOutlookExtension(configWith({ calRead: false }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'free_busy').fn({ start: 0, end: 1000, attendees: [] }, ctx)
      ).rejects.toThrow('outlook: calendar.read not enabled');
    });

    it('calendar.read check fires before any fetch call', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension(configWith({ calRead: false }));
      const ctx = createRuntimeContext();

      try {
        await getCallable(ext, 'events').fn({ start: 0, end: 1000 }, ctx);
      } catch {
        // expected
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // calendar.create capability [EC-10, AC-21]
  // ============================================================

  describe('calendar.create disabled [EC-10, AC-21]', () => {
    it('create_event throws calendar.create not enabled', async () => {
      // Default config has calendar.create = false
      const ext = createOutlookExtension({ auth: { type: 'bearer', token: 'tok' } });
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'create_event').fn(
          { title: 'Meeting', start: 0, end: 1000, options: {} },
          ctx
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('outlook: calendar.create not enabled');
    });

    it('create_event succeeds when calendar.create is enabled', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({}),
      });
      const ext = createOutlookExtension(configWith({ calCreate: true }));
      const ctx = createRuntimeContext();

      await expect(
        getCallable(ext, 'create_event').fn(
          { title: 'Meeting', start: 0, end: 1000, options: {} },
          ctx
        )
      ).resolves.toBeDefined();
    });
  });

  // ============================================================
  // Capability errors are RILL-R004 and throw before network [AC-21]
  // ============================================================

  describe('capability errors are always RILL-R004 [AC-21]', () => {
    it('disabled capability error has correct errorId', async () => {
      const ext = createOutlookExtension(configWith({ mailRead: false }));
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });
  });
});
