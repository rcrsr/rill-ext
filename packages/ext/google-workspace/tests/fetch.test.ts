/**
 * Tests for googleFetch wrapper.
 * Covers: IR-27, AC-11, EC-14..EC-20 (HTTPS check, error mapping, signal combination).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntimeContext, RuntimeError, isInvalid, getStatus, type RillValue } from '@rcrsr/rill';

// Mock auth/resolve so resolveToken is controllable without real JWT
vi.mock('../src/auth/resolve.js', () => ({
  resolveToken: vi.fn(),
}));

import { googleFetch } from '../src/fetch.js';
import { resolveToken } from '../src/auth/resolve.js';

const mockResolveToken = vi.mocked(resolveToken);

// ============================================================
// Helpers
// ============================================================

function makeCache() {
  return { slot: null };
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const BEARER_AUTH = { type: 'bearer' as const, token: 'test-token' };
const BASE_URL = 'https://gmail.googleapis.com';
const PATH = '/gmail/v1/users/me/messages';

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveToken.mockResolvedValue('resolved-token');
});

// ============================================================
// HTTPS enforcement
// ============================================================

describe('HTTPS enforcement', () => {
  it('emits #INVALID_INPUT when baseUrl uses http://', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    let caught: unknown;
    try {
      await googleFetch(
        'GET',
        'http://gmail.googleapis.com',
        PATH,
        'gmail',
        'read',
        BEARER_AUTH,
        ctx,
        controller,
        makeCache(),
        SCOPES,
      );
    } catch (e) { caught = e; }
    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught as RillValue).message).toBe('google: baseUrl must be HTTPS');
    expect(mockResolveToken).not.toHaveBeenCalled();
  });

  it('does not throw for a valid https:// baseUrl', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    // Mock fetch to return a 200 JSON response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '1' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES)
    ).resolves.not.toThrow();

    vi.unstubAllGlobals();
  });
});

// ============================================================
// Token resolution and Authorization header
// ============================================================

describe('token resolution', () => {
  it('passes auth, ctx, cache, scopes, and combined signal to resolveToken', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();
    const cache = makeCache();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, cache, SCOPES);

    expect(mockResolveToken).toHaveBeenCalledOnce();
    const [calledAuth, calledCtx, calledCache, calledScopes, calledSignal] =
      mockResolveToken.mock.calls[0]!;
    expect(calledAuth).toBe(BEARER_AUTH);
    expect(calledCtx).toBe(ctx);
    expect(calledCache).toBe(cache);
    expect(calledScopes).toBe(SCOPES);
    expect(calledSignal).toBeInstanceOf(AbortSignal);

    vi.unstubAllGlobals();
  });

  it('sets Authorization: Bearer <token> in request headers', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const authHeader = (init.headers as Record<string, string>)['Authorization'];
    expect(authHeader).toBe('Bearer resolved-token');

    vi.unstubAllGlobals();
  });
});

// ============================================================
// Request construction
// ============================================================

describe('request construction', () => {
  it('builds full URL from baseUrl + path', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}${PATH}`);

    vi.unstubAllGlobals();
  });

  it('sets Content-Type: application/json when body is present', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch('POST', BASE_URL, PATH, 'gmail', 'send', BEARER_AUTH, ctx, controller, makeCache(), SCOPES, { subject: 'hello' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ subject: 'hello' }));

    vi.unstubAllGlobals();
  });

  it('does not set Content-Type when body is absent', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('merges extra headers without overwriting Authorization', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await googleFetch(
      'GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller,
      makeCache(), SCOPES, undefined, { 'X-Goog-FieldMask': 'id,name' }
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const hdrs = init.headers as Record<string, string>;
    expect(hdrs['X-Goog-FieldMask']).toBe('id,name');
    expect(hdrs['Authorization']).toBe('Bearer resolved-token');

    vi.unstubAllGlobals();
  });
});

// ============================================================
// Response handling
// ============================================================

describe('response handling', () => {
  it('returns parsed JSON for 200 response', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ messages: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    expect(result).toEqual({ messages: [] });

    vi.unstubAllGlobals();
  });

  it('returns null for 204 No Content', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleFetch('DELETE', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it('returns null for 202 Accepted', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const result = await googleFetch('POST', BASE_URL, PATH, 'gmail', 'send', BEARER_AUTH, ctx, controller, makeCache(), SCOPES, {});
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });
});

// ============================================================
// HTTP error mapping [EC-14..EC-18]
// ============================================================

describe('HTTP error mapping', () => {
  it('maps 401 to #AUTH invalid token [EC-14]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    let caught: unknown;
    try {
      await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('AUTH');
    expect(getStatus(caught as RillValue).message).toBe('google: invalid Gmail token');

    vi.unstubAllGlobals();
  });

  it('maps 403 to #FORBIDDEN insufficient scopes [EC-15]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    let caught: unknown;
    try {
      await googleFetch('POST', BASE_URL, '/send', 'gmail', 'send', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(getStatus(caught).message).toBe('google: insufficient Gmail scopes for send');

    vi.unstubAllGlobals();
  });

  it('maps 404 with resourceId to "not found" message [EC-16]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    let caught: unknown;
    try {
      await googleFetch(
        'GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller,
        makeCache(), SCOPES, undefined, undefined, 'msg-abc'
      );
    } catch (e) { caught = e; }

    expect(getStatus(caught).message).toBe("google: Gmail resource 'msg-abc' not found");

    vi.unstubAllGlobals();
  });

  it('maps 429 to rate limit error [EC-17]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    let caught: unknown;
    try {
      await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(getStatus(caught).message).toBe('google: rate limit exceeded; retry after delay');

    vi.unstubAllGlobals();
  });

  it('maps 500 to server error [EC-18]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    let caught: unknown;
    try {
      await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(getStatus(caught).message).toBe('google: Gmail server error (500); temporarily unavailable');

    vi.unstubAllGlobals();
  });
});

// ============================================================
// Network/abort error mapping [EC-19, EC-20]
// ============================================================

describe('network and abort error mapping', () => {
  it('maps AbortError from fetch to #TIMEOUT [EC-19]', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

    let caught: unknown;
    try {
      await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(isInvalid(caught as RillValue)).toBe(true);
    expect(getStatus(caught as RillValue).code.name).toBe('TIMEOUT');
    expect(getStatus(caught as RillValue).message).toBe('google: request timeout');

    vi.unstubAllGlobals();
  });

  it('maps TypeError (network failure) to connection failed', async () => {
    const ctx = createRuntimeContext();
    const controller = new AbortController();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    let caught: unknown;
    try {
      await googleFetch('GET', BASE_URL, PATH, 'gmail', 'read', BEARER_AUTH, ctx, controller, makeCache(), SCOPES);
    } catch (e) { caught = e; }

    expect(getStatus(caught).message).toBe('google: gmail connection failed');

    vi.unstubAllGlobals();
  });
});
