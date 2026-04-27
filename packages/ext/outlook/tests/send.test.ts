/**
 * Tests for send() host function.
 * Covers: AC-6, AC-16, AC-17, AC-19, AC-37, EC-6.
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

/** Mock fetch for 202 Accepted (send returns no body). */
function mockFetch202(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 202,
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
  // AC-6: returns SendConfirmationDict
  // ============================================================

  it('returns SendConfirmationDict with sent=true [AC-6]', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'send').fn(SEND_ARGS, ctx)) as Record<string, unknown>;

    expect(result['sent']).toBe(true);
    expect(result['to']).toEqual(['recipient@example.com']);
    expect(result['subject']).toBe('Test Subject');
  });

  it('returns to as a list in SendConfirmationDict [AC-6]', async () => {
    globalThis.fetch = mockFetch202();
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'send').fn(
      { to: ['a@example.com', 'b@example.com'], subject: 'Multi', body: 'Body text' },
      ctx
    )) as Record<string, unknown>;

    expect(Array.isArray(result['to'])).toBe(true);
    expect(result['to']).toEqual(['a@example.com', 'b@example.com']);
  });

  // ============================================================
  // AC-37: to string auto-wraps to list
  // ============================================================

  it('auto-wraps string to to list [AC-37]', async () => {
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
  // AC-16: Bearer auth sends token in Authorization header
  // ============================================================

  it('sends Authorization: Bearer header with token [AC-16]', async () => {
    const mock = mockFetch202();
    globalThis.fetch = mock;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    await getCallable(ext, 'send').fn(SEND_ARGS, ctx);

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-bearer-token');
  });

  // ============================================================
  // AC-17: Session auth resolves token per call
  // ============================================================

  it('resolves session token from RuntimeContext per call [AC-17]', async () => {
    const mock = mockFetch202();
    globalThis.fetch = mock;

    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'myToken' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
      },
    });
    const ctx = createRuntimeContext();
    ctx.variables.set('myToken', 'session-token-123');

    await getCallable(ext, 'send').fn(SEND_ARGS, ctx);

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer session-token-123');
  });

  // ============================================================
  // EC-6: empty to/subject/body throws RILL-R004
  // ============================================================

  it('throws RILL-R004 for empty to [EC-6]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'send').fn({ to: [], subject: 'Subject', body: 'Body' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  expect(getStatus(caught).message).toContain('to is required');
  });

  it('throws RILL-R004 for empty subject [EC-6]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'send').fn({ to: ['r@example.com'], subject: '', body: 'Body' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  expect(getStatus(caught).message).toContain('subject is required');
  });

  it('throws RILL-R004 for empty body [EC-6]', async () => {
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'send').fn({ to: ['r@example.com'], subject: 'Subject', body: '' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
  expect(getStatus(caught).message).toContain('body is required');
  });

  // ============================================================
  // AC-19: event emission
  // ============================================================

  it('emits outlook:mail:send event on success [AC-19]', async () => {
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
