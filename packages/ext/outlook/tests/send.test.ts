/**
 * Tests for send() host function.
 * Covers: AC-6, AC-16, AC-17, AC-19, AC-37, EC-6.
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

/** Mock fetch for 202 Accepted (send returns no body). */
function mockFetch202(): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    status: 202,
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

const SEND_ARGS = {
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  body: 'Hello, this is a test message.',
};

// ============================================================
// TESTS
// ============================================================

describe('send() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ============================================================
  // returns SendConfirmationDict
  // ============================================================

  it('returns SendConfirmationDict with sent=true', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'send').fn(
      SEND_ARGS,
      ctx
    )) as Record<string, unknown>;

    expect(result['sent']).toBe(true);
    expect(result['to']).toEqual(['recipient@example.com']);
    expect(result['subject']).toBe('Test Subject');
  });

  it('returns to as a list in SendConfirmationDict', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'send').fn(
      {
        to: ['a@example.com', 'b@example.com'],
        subject: 'Multi',
        body: 'Body text',
      },
      ctx
    )) as Record<string, unknown>;

    expect(Array.isArray(result['to'])).toBe(true);
    expect(result['to']).toEqual(['a@example.com', 'b@example.com']);
  });

  // ============================================================
  // to string auto-wraps to list
  // ============================================================

  it('auto-wraps string to to list', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'send').fn(
      { to: 'single@example.com', subject: 'Test', body: 'Body text' },
      ctx
    )) as Record<string, unknown>;

    expect(result['sent']).toBe(true);
    expect(result['to']).toEqual(['single@example.com']);
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

    const caught = (await getCallable(ext, 'send').fn(args, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(message);
  });

  // ============================================================
  // event emission
  // ============================================================

  it('emits outlook:mail:send event on success', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'send').fn(SEND_ARGS, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:send',
        subsystem: 'extension:outlook',
      })
    );
  });

  it('posts to sendMail endpoint', async () => {
    const mock = mockFetch202();
    globalThis.fetch = mock;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'send').fn(SEND_ARGS, ctx);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('sendMail');
    expect(init.method).toBe('POST');
  });
});
