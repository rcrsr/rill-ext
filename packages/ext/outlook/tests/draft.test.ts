/**
 * Tests for draft() host function.
 * Covers: AC-7, AC-19, EC-6.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
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

function mockFetchJson(status: number, body: unknown): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
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

/** Graph API message returned in 201 response body for draft creation. */
const GRAPH_DRAFT_MESSAGE = {
  id: 'draft-msg-001',
  subject: 'Draft Subject',
  bodyPreview: 'Draft body preview',
  from: { emailAddress: { address: '' } },
  toRecipients: [{ emailAddress: { address: 'recipient@example.com' } }],
  receivedDateTime: undefined,
  isRead: false,
  flag: { flagStatus: 'notFlagged' },
  hasAttachments: false,
};

const DRAFT_ARGS = {
  to: ['recipient@example.com'],
  subject: 'Draft Subject',
  body: 'This is the draft body.',
};

// ============================================================
// TESTS
// ============================================================

describe('draft() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // returns MailMessageDict from 201 response body
  // ============================================================

  it('returns MailMessageDict from 201 response body', async () => {
    globalThis.fetch = mockFetchJson(201, GRAPH_DRAFT_MESSAGE);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'draft').fn(
      DRAFT_ARGS,
      ctx
    )) as Record<string, unknown>;

    expect(result['id']).toBe('draft-msg-001');
    expect(result['subject']).toBe('Draft Subject');
    expect(result['preview']).toBe('Draft body preview');
    expect(result['to']).toEqual(['recipient@example.com']);
    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('unread');
    expect(result).toHaveProperty('flagged');
    expect(result).toHaveProperty('has_attachments');
  });

  it('posts to messages endpoint with draft body', async () => {
    const mockFetch = mockFetchJson(201, GRAPH_DRAFT_MESSAGE);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'draft').fn(DRAFT_ARGS, ctx);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('messages');
    expect(init.method).toBe('POST');
  });

  it('sends subject and toRecipients in POST body', async () => {
    const mockFetch = mockFetchJson(201, GRAPH_DRAFT_MESSAGE);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'draft').fn(DRAFT_ARGS, ctx);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<
      string,
      unknown
    >;
    expect(requestBody['subject']).toBe('Draft Subject');
    expect(Array.isArray(requestBody['toRecipients'])).toBe(true);
  });

  // ============================================================
  // to as string auto-wraps to list
  // ============================================================

  it('auto-wraps string to into single-element toRecipients array', async () => {
    const mockFetch = mockFetchJson(201, GRAPH_DRAFT_MESSAGE);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'draft').fn(
      {
        to: 'single@example.com',
        subject: 'Draft Subject',
        body: 'Draft body.',
      },
      ctx
    )) as Record<string, unknown>;

    expect(result['id']).toBe('draft-msg-001');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<
      string,
      unknown
    >;
    const toRecipients = requestBody['toRecipients'] as Array<{
      emailAddress: { address: string };
    }>;
    expect(Array.isArray(toRecipients)).toBe(true);
    expect(toRecipients).toHaveLength(1);
    expect(toRecipients[0]!.emailAddress.address).toBe('single@example.com');
  });

  // ============================================================
  // empty to/subject/body throws #INVALID_INPUT
  // ============================================================

  it.each([
    {
      field: 'to',
      args: { to: [], subject: 'Subject', body: 'Body' },
      message: 'to is required',
    },
    {
      field: 'subject',
      args: { to: ['r@example.com'], subject: '', body: 'Body' },
      message: 'subject is required',
    },
    {
      field: 'body',
      args: { to: ['r@example.com'], subject: 'Subject', body: '' },
      message: 'body is required',
    },
  ])('throws #INVALID_INPUT for empty $field', async ({ args, message }) => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'draft').fn(args, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(message);
  });

  it('throws #INVALID_INPUT for missing to (undefined)', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'draft').fn(
      { subject: 'Subject', body: 'Body' },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  });

  // ============================================================
  // event emission
  // ============================================================

  it('emits outlook:mail:draft event on success', async () => {
    globalThis.fetch = mockFetchJson(201, GRAPH_DRAFT_MESSAGE);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'draft').fn(DRAFT_ARGS, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:draft',
        subsystem: 'extension:outlook',
      })
    );
  });
});
