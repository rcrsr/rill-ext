/**
 * Gmail callable tests for the Google Workspace extension.
 * Covers: IR-2..IR-8 (7 callables), AC-3, AC-4, AC-12, AC-13,
 *         EC-3, EC-6, EC-12, EC-14, EC-15, EC-17, EC-18,
 *         BC-1, BC-9, BC-10.
 *
 * Fetch is mocked globally per test. Bearer auth returns the static
 * token without any I/O, so resolveToken needs no extra mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { RuntimeError, createRuntimeContext, type ApplicationCallable, isInvalid, getStatus, type RillValue } from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createGoogleWorkspaceExtension } from '../src/factory.js';

// ============================================================
// HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

/**
 * Call a named Gmail callable and return the result.
 * Throws on error (uncaught); use try/catch in tests that expect errors.
 */
async function callGmail(
  ext: { value: unknown },
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const ctx = createRuntimeContext();
  return getCallable(ext, name).fn(args as Record<string, import('@rcrsr/rill').RillValue>, ctx);
}

// ============================================================
// FIXTURES
// ============================================================

/** All Gmail capabilities enabled. */
const ALL_GMAIL_CONFIG = {
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
  },
};

/** Build a config with all Gmail caps disabled (for capability gate tests). */
function makeNoCapConfig(overrides: Partial<typeof ALL_GMAIL_CONFIG['capabilities']['gmail']> = {}) {
  return {
    auth: { type: 'bearer' as const, token: 'test-token' },
    capabilities: {
      gmail: {
        read: false,
        search: false,
        send: false,
        draft: false,
        reply: false,
        label: false,
        modify: false,
        ...overrides,
      },
    },
  };
}

/** Minimal bearer config — defaults apply (all caps enabled). */
const BEARER_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
};

/** Mock 200 JSON response. */
function mockOkJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

/** Mock ok response with no body (204). */
function mockOkNoBody(): Response {
  return { ok: true, status: 204 } as unknown as Response;
}

/** Mock error response. */
function mockErrorResponse(status: number): Response {
  return { ok: false, status } as unknown as Response;
}

// ============================================================
// SETUP / TEARDOWN
// ============================================================

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ============================================================
// AC-4 / EC-3: Capability gating (all 7 Gmail callables)
// ============================================================

describe('capability gating [AC-4, EC-3]', () => {
  it('gmail_send with gmail.send=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_send').fn(
        { to: 'a@b.com', subject: 'Hi', body: 'Hello' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.send');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_draft with gmail.draft=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_draft').fn(
        { to: 'a@b.com', subject: 'Hi', body: 'Hello' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.draft');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_reply with gmail.reply=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_reply').fn(
        { message_id: 'm1', body: 'ok' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.reply');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_flag with gmail.modify=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_flag').fn(
        { message_id: 'm1', flagged: true },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.modify');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_label with gmail.label=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_label').fn(
        { message_id: 'm1', label_name: 'Important' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.label');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_search with gmail.search=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'hello' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    // gmail_search checks both gmail.read and gmail.search — either hits first
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('gmail_read with gmail.read=false → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ext = createGoogleWorkspaceExtension(makeNoCapConfig(), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_read').fn({ message_id: 'm1' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.read');
    expect(getStatus(caught).message).toContain('not enabled');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ============================================================
// Success cases [AC-12, AC-13]
// ============================================================

describe('gmail_search success [AC-12, AC-13]', () => {
  it('returns { messages: [{ id, threadId }] } dict', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ messages: [{ id: 'm1', threadId: 't1' }] })
    ) as typeof fetch;

    const result = (await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_search',
      { query: 'from:alice' }
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('messages');
    const messages = result['messages'] as Array<Record<string, unknown>>;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]!['id']).toBe('m1');
    expect(messages[0]!['thread_id']).toBe('t1');
  });

  it('emits google:gmail:search event with duration [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ messages: [{ id: 'm1', threadId: 't1' }] })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'google:gmail:search',
        subsystem: 'extension:google-workspace',
      })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });

  it('returns rill primitives only (no class instances) [AC-12]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ messages: [{ id: 'm2', threadId: 't2' }] })
    ) as typeof fetch;

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_search',
      { query: 'subject:hello' }
    );

    // Must be a plain object, not a class instance
    expect(result !== null && typeof result === 'object').toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('gmail_read success [AC-12, AC-13]', () => {
  const GMAIL_MESSAGE_PAYLOAD = {
    id: 'msg-1',
    threadId: 'thread-1',
    payload: {
      headers: [
        { name: 'From', value: 'alice@example.com' },
        { name: 'To', value: 'bob@example.com' },
        { name: 'Subject', value: 'Hello World' },
        { name: 'Date', value: 'Mon, 01 Jan 2024 00:00:00 +0000' },
      ],
      mime_type: 'text/plain',
      body: {
        data: Buffer.from('Hello from Alice!').toString('base64'),
      },
      parts: [],
    },
  };

  it('returns dict with id, threadId, headers, body, attachments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson(GMAIL_MESSAGE_PAYLOAD)
    ) as typeof fetch;

    const result = (await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_read',
      { message_id: 'msg-1' }
    )) as Record<string, unknown>;

    expect(result['id']).toBe('msg-1');
    expect(result['thread_id']).toBe('thread-1');
    expect(typeof result['body']).toBe('string');
    expect(Array.isArray(result['attachments'])).toBe(true);

    const headers = result['headers'] as Record<string, unknown>;
    expect(typeof headers).toBe('object');
    expect(headers['from']).toBe('alice@example.com');
    expect(headers['to']).toBe('bob@example.com');
    expect(headers['subject']).toBe('Hello World');
  });

  it('emits google:gmail:read event with duration [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson(GMAIL_MESSAGE_PAYLOAD)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_read').fn({ message_id: 'msg-1' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:read' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('gmail_send success [AC-12, AC-13]', () => {
  it('returns sent message ID string [IR-4]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'sent-id' })
    ) as typeof fetch;

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_send',
      { to: 'bob@example.com', subject: 'Test', body: 'Hello' }
    );

    expect(result).toBe('sent-id');
  });

  it('emits google:gmail:send event with duration [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'sent-id' })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_send').fn(
      { to: 'bob@example.com', subject: 'Test', body: 'Hello' },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:send' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('gmail_draft success [AC-12, AC-13]', () => {
  it('returns draft ID string [IR-5]', async () => {
    // drafts API returns { id, message: { id, ... } }
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'draft-id', message: { id: 'msg-id' } })
    ) as typeof fetch;

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_draft',
      { to: 'bob@example.com', subject: 'Draft', body: 'Draft body' }
    );

    expect(result).toBe('draft-id');
  });

  it('emits google:gmail:draft event with duration [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'draft-id' })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_draft').fn(
      { to: 'bob@example.com', subject: 'Draft', body: 'body' },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:draft' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('gmail_reply success [AC-12, AC-13]', () => {
  /** First fetch: metadata fetch; Second fetch: send. */
  function mockReplyFetches(sentId: string) {
    const mockFetchImpl = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({
          id: 'original-msg',
          threadId: 'thread-abc',
          payload: {
            headers: [
              { name: 'Message-Id', value: '<original@example.com>' },
              { name: 'References', value: '' },
              { name: 'Subject', value: 'Original Subject' },
              { name: 'From', value: 'alice@example.com' },
            ],
          },
        })
      )
      .mockResolvedValueOnce(mockOkJson({ id: sentId }));

    globalThis.fetch = mockFetchImpl as typeof fetch;
    return mockFetchImpl;
  }

  it('returns sent message ID string [IR-6]', async () => {
    mockReplyFetches('reply-sent-id');

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_reply',
      { message_id: 'original-msg', body: 'Reply here' }
    );

    expect(result).toBe('reply-sent-id');
  });

  it('makes two fetches: GET metadata then POST send', async () => {
    const mockFetchImpl = mockReplyFetches('reply-id');

    await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_reply',
      { message_id: 'original-msg', body: 'Reply here' }
    );

    expect(mockFetchImpl.mock.calls).toHaveLength(2);
    const [firstUrl] = mockFetchImpl.mock.calls[0] as [string];
    const [secondUrl] = mockFetchImpl.mock.calls[1] as [string];
    expect(firstUrl).toContain('original-msg');
    expect(secondUrl).toContain('messages/send');
  });

  it('emits google:gmail:reply event with duration [AC-13]', async () => {
    mockReplyFetches('reply-sent-id');

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_reply').fn(
      { message_id: 'original-msg', body: 'Reply here' },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:reply' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('gmail_flag success [AC-12, AC-13]', () => {
  it('gmail_flag(messageId, true) → returns true [IR-7]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'm1', labelIds: ['STARRED'] })
    ) as typeof fetch;

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_flag',
      { message_id: 'm1', flagged: true }
    );

    expect(result).toBe(true);
  });

  it('gmail_flag(messageId, false) → returns true [IR-7]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'm1', labelIds: [] })
    ) as typeof fetch;

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_flag',
      { message_id: 'm1', flagged: false }
    );

    expect(result).toBe(true);
  });

  it('emits google:gmail:flag event with duration [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ id: 'm1', labelIds: ['STARRED'] })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_flag').fn(
      { message_id: 'm1', flagged: true },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:flag' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

describe('gmail_label success [AC-12, AC-13]', () => {
  /** Mock: first GET /labels, then POST /modify. */
  function mockLabelFetches() {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({ labels: [{ id: 'L1', name: 'Important' }] })
      )
      .mockResolvedValueOnce(
        mockOkJson({ id: 'm1', labelIds: ['L1'] })
      ) as typeof fetch;
  }

  it('returns true after successful label apply [IR-8]', async () => {
    mockLabelFetches();

    const result = await callGmail(
      createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx()),
      'gmail_label',
      { message_id: 'm1', label_name: 'Important' }
    );

    expect(result).toBe(true);
  });

  it('emits google:gmail:label event with duration [AC-13]', async () => {
    mockLabelFetches();

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'gmail_label').fn(
      { message_id: 'm1', label_name: 'Important' },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'google:gmail:label' })
    );
    const call = onLogEvent.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call['duration']).toBe('number');
  });
});

// ============================================================
// BC-1: gmail_search maxResults truncation
// ============================================================

describe('BC-1: gmail_search maxResults truncation', () => {
  it('truncates options.maxResults to gmail.maxResults ceiling', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ messages: [] })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension({
      auth: { type: 'bearer' as const, token: 'test-token' },
      gmail: { maxResults: 10 },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'gmail_search').fn(
      { query: 'test', options: { max_results: 50 } },
      ctx
    );

    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(mockFetchImpl.mock.calls).toHaveLength(1);
    const [calledUrl] = mockFetchImpl.mock.calls[0] as [string];
    expect(calledUrl).toContain('maxResults=10');
    expect(calledUrl).not.toContain('maxResults=50');
  });

  it('uses options.maxResults when below ceiling', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson({ messages: [] })
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension({
      auth: { type: 'bearer' as const, token: 'test-token' },
      gmail: { maxResults: 50 },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'gmail_search').fn(
      { query: 'test', options: { max_results: 10 } },
      ctx
    );

    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [calledUrl] = mockFetchImpl.mock.calls[0] as [string];
    expect(calledUrl).toContain('maxResults=10');
  });
});

// ============================================================
// BC-9 / BC-10 / EC-6 / EC-12: allowedLabels / deniedLabels
// ============================================================

describe('allowedLabels / deniedLabels [BC-9, BC-10, EC-6, EC-12]', () => {
  it('BC-9: no allowedLabels config → all labels accepted (proceeds to fetch)', async () => {
    // Two fetches: GET /labels, POST /modify
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({ labels: [{ id: 'L1', name: 'AnyLabel' }] })
      )
      .mockResolvedValueOnce(
        mockOkJson({ id: 'm1', labelIds: ['L1'] })
      ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const result = await callGmail(ext, 'gmail_label', {
      message_id: 'm1',
      label_name: 'AnyLabel',
    });

    expect(result).toBe(true);
    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    // Two fetches must have occurred (labels list + modify)
    expect(mockFetchImpl.mock.calls).toHaveLength(2);
  });

  it('BC-10: allowedLabels set + label not in list → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;

    const ext = createGoogleWorkspaceExtension({
      auth: { type: 'bearer' as const, token: 'test-token' },
      gmail: { allowedLabels: ['Important'] },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_label').fn(
        { message_id: 'm1', label_name: 'Spam' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain("label 'Spam' not in allowed set");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('EC-12: deniedLabels includes label → #FORBIDDEN before fetch', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;

    const ext = createGoogleWorkspaceExtension({
      auth: { type: 'bearer' as const, token: 'test-token' },
      gmail: { deniedLabels: ['Spam'] },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_label').fn(
        { message_id: 'm1', label_name: 'Spam' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain("label 'Spam' in denied set");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('BC-10: allowedLabels set + label in list → succeeds (fetch proceeds)', async () => {
    // Two fetches: GET /labels list, POST /modify
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({ labels: [{ id: 'L1', name: 'IMPORTANT' }] })
      )
      .mockResolvedValueOnce(
        mockOkJson({ id: 'm1', labelIds: ['L1'] })
      ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension({
      auth: { type: 'bearer' as const, token: 'test-token' },
      gmail: { allowedLabels: ['IMPORTANT'] },
    }, makeFactoryCtx());

    const result = await callGmail(ext, 'gmail_label', {
      message_id: 'm1',
      label_name: 'IMPORTANT',
    });

    expect(result).toBe(true);
    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(mockFetchImpl.mock.calls).toHaveLength(2);
  });

  it('EC-6: gmail.label=false + valid label → #FORBIDDEN before fetch (cap gate fires first)', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;

    const ext = createGoogleWorkspaceExtension(makeNoCapConfig({ label: false }), makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_label').fn(
        { message_id: 'm1', label_name: 'Important' },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('gmail.label');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ============================================================
// HTTP error mapping [EC-14, EC-15, EC-17, EC-18]
// ============================================================

describe('HTTP error mapping [EC-14, EC-15, EC-17, EC-18]', () => {
  it('EC-14: 401 → "google: invalid Gmail token"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockErrorResponse(401)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('AUTH');
  expect(getStatus(caught).message).toBe('google: invalid Gmail token');
  });

  it('EC-15: 403 → "google: insufficient Gmail scopes for <op>"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockErrorResponse(403)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
  expect(getStatus(caught).message).toContain('insufficient Gmail scopes');
  });

  it('EC-17: 429 → "google: rate limit exceeded; retry after delay"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockErrorResponse(429)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('RATE_LIMIT');
expect(getStatus(caught as RillValue).message).toBe(
      'google: rate limit exceeded; retry after delay'
    );
  });

  it('EC-18: 503 → "google: Gmail server error (503); temporarily unavailable"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockErrorResponse(503)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('UNAVAILABLE');
expect(getStatus(caught as RillValue).message).toBe(
      'google: Gmail server error (503); temporarily unavailable'
    );
  });

  it('EC-18: 500 → "google: Gmail server error (500); temporarily unavailable"', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockErrorResponse(500)
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('UNAVAILABLE');
    expect(getStatus(caught).message).toBe('google: Gmail server error (500); temporarily unavailable');
  });
});

// ============================================================
// Integration depth: Session auth → gmail_read resolves token from context [IR-21]
// ============================================================

describe('gmail_read session auth [IR-21, AC-12]', () => {
  const GMAIL_MESSAGE_PAYLOAD = {
    id: 'msg-session',
    threadId: 'thread-session',
    payload: {
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'receiver@example.com' },
        { name: 'Subject', value: 'Session Token Test' },
        { name: 'Date', value: 'Mon, 01 Jan 2024 00:00:00 +0000' },
      ],
      mime_type: 'text/plain',
      body: { data: Buffer.from('Session body').toString('base64') },
      parts: [],
    },
  };

  it('resolves bearer token from ctx.variables at call time and returns message dict', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockOkJson(GMAIL_MESSAGE_PAYLOAD)
    ) as typeof fetch;

    const sessionConfig = {
      auth: { type: 'session' as const, tokenVar: 'google_token' },
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
      },
    };

    const ext = createGoogleWorkspaceExtension(sessionConfig, makeFactoryCtx());
    const ctx = createRuntimeContext();
    // Inject the token into the context variable at call time (IR-21 session branch)
    ctx.variables.set('google_token', 'session-resolved-token');

    const result = (await getCallable(ext, 'gmail_read').fn(
      { message_id: 'msg-session' },
      ctx
    )) as Record<string, unknown>;

    // Verify the resolved token was sent in the Authorization header
    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = mockFetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer session-resolved-token');

    // Verify rill primitive return shape [AC-12]
    expect(result['id']).toBe('msg-session');
    expect(result['thread_id']).toBe('thread-session');
    expect(typeof result['body']).toBe('string');
    expect(Array.isArray(result['attachments'])).toBe(true);
  });

  it('emits #AUTH when session tokenVar not found in context (IR-21 error path)', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;

    const sessionConfig = {
      auth: { type: 'session' as const, tokenVar: 'missing_token' },
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
      },
    };

    const ext = createGoogleWorkspaceExtension(sessionConfig, makeFactoryCtx());
    const ctx = createRuntimeContext();
    // Intentionally do not set 'missing_token' in ctx.variables

    const caught = (await getCallable(ext, 'gmail_read').fn({ message_id: 'msg-x' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('AUTH');
    expect(getStatus(caught).message).toContain("session token 'missing_token' not found");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ============================================================
// Integration depth: Service-account auth → gmail_send JWT exchange path [AC-9, AC-10, AC-12]
// ============================================================

describe('gmail_send service-account auth [AC-9, AC-10, AC-12]', () => {
  // Generate a test RSA key pair for JWT signing (service-account path).
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  const SA_KEY_JSON = JSON.stringify({
    client_email: 'test-sa@test-project.iam.gserviceaccount.com',
    private_key: privateKeyPem,
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  const SA_CONFIG = {
    auth: { type: 'service-account' as const, keyJson: SA_KEY_JSON },
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
    },
  };

  it('exchanges JWT for access token then sends message, returning message ID string', async () => {
    // First fetch: POST to token exchange endpoint
    // Second fetch: POST to Gmail send endpoint
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({ access_token: 'sa-access-token', expires_in: 3600, token_type: 'Bearer' })
      )
      .mockResolvedValueOnce(
        mockOkJson({ id: 'sa-sent-msg-id' })
      ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(SA_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = await getCallable(ext, 'gmail_send').fn(
      { to: 'recipient@example.com', subject: 'SA Test', body: 'Hello from SA' },
      ctx
    );

    // Verify return value is the message ID string [AC-12]
    expect(result).toBe('sa-sent-msg-id');
    expect(typeof result).toBe('string');

    // Verify two fetch calls occurred: token exchange + API send
    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(mockFetchImpl.mock.calls).toHaveLength(2);

    // First call must be the OAuth2 token endpoint [AC-9]
    const [firstUrl] = mockFetchImpl.mock.calls[0] as [string];
    expect(firstUrl).toBe('https://oauth2.googleapis.com/token');

    // Second call must use the access token in the Authorization header
    const [, secondInit] = mockFetchImpl.mock.calls[1] as [string, RequestInit];
    const secondHeaders = secondInit.headers as Record<string, string>;
    expect(secondHeaders['Authorization']).toBe('Bearer sa-access-token');
  });

  it('caches the access token: second call reuses token without a new exchange [AC-10]', async () => {
    // First call: token exchange + API
    // Second call: only API (cache hit)
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(
        mockOkJson({ access_token: 'cached-sa-token', expires_in: 3600, token_type: 'Bearer' })
      )
      .mockResolvedValueOnce(mockOkJson({ id: 'msg-1' }))
      .mockResolvedValueOnce(mockOkJson({ id: 'msg-2' })) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(SA_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    // First call — triggers token exchange
    await getCallable(ext, 'gmail_send').fn(
      { to: 'a@example.com', subject: 'First', body: 'First call' },
      ctx
    );

    // Second call — should reuse cached token (only 1 more fetch, not 2)
    await getCallable(ext, 'gmail_send').fn(
      { to: 'b@example.com', subject: 'Second', body: 'Second call' },
      ctx
    );

    const mockFetchImpl = globalThis.fetch as ReturnType<typeof vi.fn>;
    // Total: 1 token exchange + 2 API calls = 3 fetches
    expect(mockFetchImpl.mock.calls).toHaveLength(3);

    // First call is the token exchange
    const [firstUrl] = mockFetchImpl.mock.calls[0] as [string];
    expect(firstUrl).toBe('https://oauth2.googleapis.com/token');

    // Second and third calls are both API calls (not token exchanges)
    const [secondUrl] = mockFetchImpl.mock.calls[1] as [string];
    const [thirdUrl] = mockFetchImpl.mock.calls[2] as [string];
    expect(secondUrl).toContain('gmail.googleapis.com');
    expect(thirdUrl).toContain('gmail.googleapis.com');
  });
});

// ============================================================
// Integration depth: AC-11 AbortSignal.timeout(30_000) verification
// ============================================================

describe('AC-11: AbortSignal combined via AbortSignal.any with 30s timeout', () => {
  it('gmail_search passes a combined AbortSignal to fetch (AbortSignal instance)', async () => {
    let capturedSignal: AbortSignal | undefined;

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return Promise.resolve(
          mockOkJson({ messages: [{ id: 'm1', threadId: 't1' }] })
        );
      }
    ) as typeof fetch;

    const ext = createGoogleWorkspaceExtension(ALL_GMAIL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'gmail_search').fn({ query: 'test' }, ctx);

    // AC-11: signal must be an AbortSignal instance combining controller + 30s timeout
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // Signal must not be pre-aborted (request completed successfully)
    expect(capturedSignal!.aborted).toBe(false);
  });
});

// ============================================================
// AC-3: params yield valid JSON Schema shape
// ============================================================

describe('AC-3: callable params are valid RillParam objects', () => {
  const GMAIL_CALLABLES = [
    'gmail_search',
    'gmail_read',
    'gmail_send',
    'gmail_draft',
    'gmail_reply',
    'gmail_flag',
    'gmail_label',
  ] as const;

  it('every Gmail callable has at least one param with name, type, defaultValue, annotations', () => {
    const ext = createGoogleWorkspaceExtension(BEARER_CONFIG, makeFactoryCtx());
    const value = ext.value as Record<string, ApplicationCallable>;

    for (const name of GMAIL_CALLABLES) {
      const callable = value[name]!;
      expect(Array.isArray(callable.params)).toBe(true);
      expect(callable.params.length).toBeGreaterThan(0);

      for (const param of callable.params) {
        expect(typeof param.name).toBe('string');
        expect(param.name.length).toBeGreaterThan(0);
        expect(param.type).toBeDefined();
        expect('defaultValue' in param).toBe(true);
        expect(typeof param.annotations).toBe('object');
      }
    }
  });

  it('gmail_search first param is "query" with string type', () => {
    const ext = createGoogleWorkspaceExtension(BEARER_CONFIG, makeFactoryCtx());
    const callable = (ext.value as Record<string, ApplicationCallable>)['gmail_search']!;
    const firstParam = callable.params[0]!;

    expect(firstParam.name).toBe('query');
    expect((firstParam.type as { kind: string }).kind).toBe('string');
  });

  it('gmail_flag second param is "flagged" with bool type', () => {
    const ext = createGoogleWorkspaceExtension(BEARER_CONFIG, makeFactoryCtx());
    const callable = (ext.value as Record<string, ApplicationCallable>)['gmail_flag']!;
    const secondParam = callable.params[1]!;

    expect(secondParam.name).toBe('flagged');
    expect((secondParam.type as { kind: string }).kind).toBe('bool');
  });

  it('gmail_label params are messageId (str) and labelName (str)', () => {
    const ext = createGoogleWorkspaceExtension(BEARER_CONFIG, makeFactoryCtx());
    const callable = (ext.value as Record<string, ApplicationCallable>)['gmail_label']!;

    expect(callable.params[0]!.name).toBe('message_id');
    expect(callable.params[1]!.name).toBe('label_name');
    expect((callable.params[0]!.type as { kind: string }).kind).toBe('string');
    expect((callable.params[1]!.type as { kind: string }).kind).toBe('string');
  });
});
