/**
 * Tests for inbox() and read() host functions.
 * Covers: AC-2, AC-5, AC-16, AC-17, AC-18, AC-19, AC-22, AC-31, AC-32, AC-33, EC-3, EC-4.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext, type ApplicationCallable, isInvalid, getStatus, type RillValue } from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createOutlookExtension } from '../src/factory.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function mockFetchJson(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

// ============================================================
// FIXTURES
// ============================================================

const BEARER_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-bearer-token' },
  capabilities: {
    mail: { read: true, send: true, draft: true, flag: true, search: true },
  },
};

/** Minimal Graph API message object with all fields populated. */
const GRAPH_MESSAGE = {
  id: 'msg-001',
  subject: 'Hello World',
  bodyPreview: 'This is a preview',
  from: { emailAddress: { address: 'sender@example.com' } },
  toRecipients: [{ emailAddress: { address: 'recipient@example.com' } }],
  receivedDateTime: '2024-01-15T10:30:00Z',
  isRead: false,
  flag: { flagStatus: 'notFlagged' },
  hasAttachments: false,
};

const GRAPH_MESSAGE_LIST = { value: [GRAPH_MESSAGE] };
const GRAPH_EMPTY_LIST = { value: [] };

// ============================================================
// TESTS
// ============================================================

describe('inbox() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // AC-2: returns MailMessageDict list with 9 fields
  // ============================================================

  describe('returns MailMessageDict list [AC-2]', () => {
    it('returns messages array with 9-field MailMessageDict objects', async () => {
      globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'inbox').fn({}, ctx)) as Record<string, unknown>;
      const messages = result['messages'] as Record<string, unknown>[];

      expect(Array.isArray(messages)).toBe(true);
      expect(messages).toHaveLength(1);

      const msg = messages[0]!;
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('subject');
      expect(msg).toHaveProperty('preview');
      expect(msg).toHaveProperty('from');
      expect(msg).toHaveProperty('to');
      expect(msg).toHaveProperty('date');
      expect(msg).toHaveProperty('unread');
      expect(msg).toHaveProperty('flagged');
      expect(msg).toHaveProperty('has_attachments');
    });

    it('normalizes field values from Graph response', async () => {
      globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'inbox').fn({}, ctx)) as Record<string, unknown>;
      const msg = (result['messages'] as Record<string, unknown>[])[0]!;

      expect(msg['id']).toBe('msg-001');
      expect(msg['subject']).toBe('Hello World');
      expect(msg['preview']).toBe('This is a preview');
      expect(msg['from']).toBe('sender@example.com');
      expect(msg['to']).toEqual(['recipient@example.com']);
      expect(typeof msg['date']).toBe('number');
      expect(msg['unread']).toBe(true);
      expect(msg['flagged']).toBe(false);
      expect(msg['has_attachments']).toBe(false);
    });
  });

  // ============================================================
  // AC-33: empty inbox returns empty list
  // ============================================================

  it('returns empty messages array when inbox is empty [AC-33]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'inbox').fn({}, ctx)) as Record<string, unknown>;
    const messages = result['messages'] as unknown[];

    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(0);
  });

  // ============================================================
  // AC-31: top=0 returns empty list
  // ============================================================

  it('uses maxResults when top=0 is passed [AC-31]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({ top: 0 }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('$top=50');
  });

  // ============================================================
  // AC-32: result count capped at maxResults
  // ============================================================

  it('caps top at configured maxResults [AC-32]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension({ ...BEARER_CONFIG, mail: { maxResults: 10 } });
    const ctx = createRuntimeContext();

    // Request 999, but maxResults is 10
    await getCallable(ext, 'inbox').fn({ top: 999 }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('$top=10');
    expect(url).not.toContain('$top=999');
  });

  // ============================================================
  // Unread filter
  // ============================================================

  it('adds $filter=isRead eq false when unread=true', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({ unread: true }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('isRead eq false');
  });

  it('uses $orderby=receivedDateTime desc when unread is not set', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({}, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('orderby=receivedDateTime');
  });

  // ============================================================
  // AC-16: Bearer auth sends token in Authorization header
  // ============================================================

  it('sends Authorization: Bearer header with token [AC-16]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({}, ctx);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-bearer-token');
  });

  // ============================================================
  // AC-17: Session auth resolves token per call
  // ============================================================

  it('resolves session token from RuntimeContext per call [AC-17]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;

    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'myToken' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
      },
    });
    const ctx = createRuntimeContext();
    ctx.variables.set('myToken', 'session-token-abc');

    await getCallable(ext, 'inbox').fn({}, ctx);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer session-token-abc');
  });

  // ============================================================
  // AC-18: Shared mailbox uses /users/{mailbox}/ endpoint
  // ============================================================

  it('uses /users/{mailbox}/ path for shared mailbox [AC-18]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;

    const ext = createOutlookExtension({
      ...BEARER_CONFIG,
      mailbox: 'shared@example.com',
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({}, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users/shared@example.com/');
  });

  it('uses /me/ path when no shared mailbox configured', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'inbox').fn({}, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/me/');
  });

  // ============================================================
  // AC-19: Event emission
  // ============================================================

  it('emits outlook:mail:read event on success [AC-19]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'inbox').fn({}, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:read',
        subsystem: 'extension:outlook',
      })
    );
  });

  // ============================================================
  // AC-22 / EC-4: Folder allowlist enforcement
  // ============================================================

  describe('folder allowlist enforcement', () => {
    it('uses mailFolders/{folder}/messages path when folder is in allowlist [AC-22]', async () => {
      const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension({
        ...BEARER_CONFIG,
        mail: { folders: ['inbox', 'sent'] },
      });
      const ctx = createRuntimeContext();

      await getCallable(ext, 'inbox').fn({ folder: 'sent' }, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('mailFolders/sent/messages');
    });

    it('emits #FORBIDDEN when folder is not in allowlist [EC-4]', async () => {
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'inbox').fn({ folder: 'drafts' }, ctx)) as RillValue;
      expect(isInvalid(caught)).toBe(true);
      expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain("folder 'drafts' not accessible");
    });

    it('does not call fetch when folder is not in allowlist', async () => {
      const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      try {
        await getCallable(ext, 'inbox').fn({ folder: 'drafts' }, ctx);
      } catch {
        // expected to throw
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses default /messages path when no folder arg is provided', async () => {
      const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
      globalThis.fetch = mockFetch;
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();

      await getCallable(ext, 'inbox').fn({}, ctx);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/messages?');
      expect(url).not.toContain('mailFolders');
    });
  });
});

// ============================================================
// read() host function [AC-5, W-1]
// ============================================================

describe('read() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns single MailMessageDict by message_id [AC-5]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'read').fn(
      { message_id: 'msg-001' },
      ctx
    )) as Record<string, unknown>;

    expect(result['id']).toBe('msg-001');
    expect(result['subject']).toBe('Hello World');
    expect(result['from']).toBe('sender@example.com');
    expect(result).toHaveProperty('to');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('unread');
    expect(result).toHaveProperty('flagged');
    expect(result).toHaveProperty('has_attachments');
  });

  it('sends GET to messages/{message_id} path', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_MESSAGE);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'read').fn({ message_id: 'msg-001' }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('messages/msg-001');
  });

  it('throws #INVALID_INPUT for empty message_id [EC-3]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'read').fn({ message_id: '' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('message_id is required');
  });

  it('emits outlook:mail:read event on success [AC-19]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'read').fn({ message_id: 'msg-001' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:read',
        subsystem: 'extension:outlook',
      })
    );
  });
});
