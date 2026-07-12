/**
 * Tests for search() host function.
 * Covers: AC-4, AC-19, EC-3.
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

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

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
  id: 'msg-search-001',
  subject: 'Meeting Notes',
  bodyPreview: 'Notes from the meeting',
  from: { emailAddress: { address: 'organizer@example.com' } },
  toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
  receivedDateTime: '2024-01-15T10:30:00Z',
  isRead: true,
  flag: { flagStatus: 'notFlagged' },
  hasAttachments: false,
};

const GRAPH_MESSAGE_LIST = { value: [GRAPH_MESSAGE] };
const GRAPH_EMPTY_LIST = { value: [] };

// ============================================================
// TESTS
// ============================================================

describe('search() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // AC-4: uses $search parameter
  // ============================================================

  it('includes $search parameter in URL [AC-4]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'search').fn({ query: 'meeting notes' }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('$search=');
    expect(url).toContain('meeting%20notes');
  });

  it('wraps query value in double quotes in $search [AC-4]', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'search').fn({ query: 'project alpha' }, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    // URL-encoded double quotes around the query value
    expect(url).toMatch(/\$search=%22.*%22|\$search=".*"/);
  });

  it('returns MailMessageDict list from search results [AC-4]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'search').fn(
      { query: 'meeting' },
      ctx
    )) as Record<string, unknown>;

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

  it('includes query in return value', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'search').fn(
      { query: 'budget report' },
      ctx
    )) as Record<string, unknown>;

    expect(result['query']).toBe('budget report');
  });

  it('sends GET request to messages endpoint', async () => {
    const mockFetch = mockFetchJson(200, GRAPH_EMPTY_LIST);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'search').fn({ query: 'test query' }, ctx);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('messages');
    expect(init.method).toBe('GET');
  });

  // ============================================================
  // EC-3: empty query throws #INVALID_INPUT
  // ============================================================

  it('throws #INVALID_INPUT for empty query [EC-3]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'search').fn(
      { query: '' },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('query is required');
  });

  it('throws #INVALID_INPUT for whitespace-only query [EC-3]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'search').fn(
      { query: '   ' },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  });

  // ============================================================
  // AC-19: event emission
  // ============================================================

  it('emits outlook:mail:search event on success [AC-19]', async () => {
    globalThis.fetch = mockFetchJson(200, GRAPH_MESSAGE_LIST);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'search').fn({ query: 'meeting notes' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:search',
        subsystem: 'extension:outlook',
      })
    );
  });
});
