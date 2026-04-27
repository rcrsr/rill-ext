/**
 * Tests for from() host function.
 * Covers: AC-3, AC-19, EC-3.
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

const GRAPH_MESSAGE = {
  id: 'msg-from-001',
  subject: 'From sender',
  bodyPreview: 'Message preview',
  from: { emailAddress: { address: 'sender@example.com' } },
  toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
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

describe('from() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // AC-3: filters by sender address
  // ============================================================

  it('includes sender address in $filter query param [AC-3]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'from').fn({ address: 'sender@example.com' }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sender@example.com');
    expect(url).toContain('$filter=');
  });

  it('returns MailMessageDict list filtered by sender [AC-3]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'from').fn(
      { address: 'sender@example.com' },
      ctx
    )) as Record<string, unknown>;

    const messages = result['messages'] as Record<string, unknown>[];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!['from']).toBe('sender@example.com');
  });

  it('uses Graph OData filter with from/emailAddress/address', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'from').fn({ address: 'sender@example.com' }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("from/emailAddress/address");
    expect(url).toContain("'sender@example.com'");
  });

  it('sends GET request to messages endpoint', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'from').fn({ address: 'sender@example.com' }, ctx);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('messages');
    expect(init.method).toBe('GET');
  });

  // ============================================================
  // EC-3: empty address throws RILL-R004
  // ============================================================

  it('throws RILL-R004 for empty address [EC-3]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'from').fn({ address: '' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  expect(getStatus(caught).message).toContain('address is required');
  });

  it('throws RILL-R004 for whitespace-only address [EC-3]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'from').fn({ address: '   ' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
});

  // ============================================================
  // AC-19: event emission
  // ============================================================

  it('emits outlook:mail:read event on success [AC-19]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'from').fn({ address: 'sender@example.com' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:read',
        subsystem: 'extension:outlook',
      })
    );
  });
});
