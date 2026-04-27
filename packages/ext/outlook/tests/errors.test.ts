/**
 * Error mapping tests for Outlook extension.
 * Mocks fetch to trigger HTTP and network errors through a live host function call.
 * Also tests session token resolution failures.
 * Covers: AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, EC-11, EC-12.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  getStatus,
  isInvalid,
  type ApplicationCallable,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createOutlookExtension } from '../src/factory.js';
import { mapGraphError, mapFetchError } from '../src/errors.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

function expectInvalid(
  result: unknown,
  atom: string,
  message?: string,
): void {
  const value = result as RillValue;
  expect(isInvalid(value)).toBe(true);
  const status = getStatus(value);
  expect(status.code.name).toBe(atom);
  if (message !== undefined) {
    expect(status.message).toContain(message);
  }
}

/** Build a fetch mock returning a non-OK response with the given status. */
function mockHttpError(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
  });
}

/** Build a fetch mock that rejects with the given error. */
function mockFetchReject(error: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(error);
}

const BEARER_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    mail: { read: true, send: true, draft: true, flag: true, search: true },
    calendar: { read: true, create: true },
  },
};

// ============================================================
// mapGraphError unit tests [EC-12]
// ============================================================

describe('mapGraphError', () => {
  it('maps 401 to authentication failed [AC-23, EC-12]', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapGraphError(ctx, 401, 'inbox'),
      'AUTH',
      'outlook: authentication failed (401)',
    );
  });

  it('maps 403 to insufficient permissions with operation [AC-24, EC-12]', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapGraphError(ctx, 403, 'send'),
      'FORBIDDEN',
      'outlook: insufficient permissions for send',
    );
  });

  it('maps 403 with different operation names', () => {
    const ctx = makeCtx();
    expect(getStatus(mapGraphError(ctx, 403, 'read')).message).toContain('read');
    expect(getStatus(mapGraphError(ctx, 403, 'calendar/events')).message).toContain('calendar/events');
  });

  it('maps 404 to message not found with id [AC-25, EC-12]', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapGraphError(ctx, 404, 'read', 'msg-abc-123'),
      'NOT_FOUND',
      "outlook: message 'msg-abc-123' not found",
    );
  });

  it('maps 404 without id uses operation as identifier [AC-25]', () => {
    const ctx = makeCtx();
    expect(getStatus(mapGraphError(ctx, 404, 'inbox/msg-xyz')).message).toContain('not found');
  });

  it('maps 429 to rate limit exceeded with no retry message [AC-26, EC-12]', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapGraphError(ctx, 429, 'inbox'),
      'RATE_LIMIT',
      'outlook: rate limit exceeded',
    );
  });

  it('maps 500 to server error', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapGraphError(ctx, 500, 'inbox'),
      'UNAVAILABLE',
      'outlook: server error (500)',
    );
  });

  it('maps 503 to server error', () => {
    const ctx = makeCtx();
    expect(getStatus(mapGraphError(ctx, 503, 'inbox')).message).toBe('outlook: server error (503)');
  });

  it('maps 599 to server error', () => {
    const ctx = makeCtx();
    expect(getStatus(mapGraphError(ctx, 599, 'inbox')).message).toBe('outlook: server error (599)');
  });

  it('maps unknown status to generic failed message', () => {
    const ctx = makeCtx();
    expect(getStatus(mapGraphError(ctx, 418, 'inbox')).message).toBe('outlook: request failed (418)');
  });
});

// ============================================================
// mapFetchError unit tests [EC-12]
// ============================================================

describe('mapFetchError', () => {
  it('maps AbortError to request timeout [AC-27, EC-12]', () => {
    const ctx = makeCtx();
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    expectInvalid(mapFetchError(ctx, abortErr), 'TIMEOUT', 'outlook: request timeout');
  });

  it('maps TypeError to connection failed [EC-12]', () => {
    const ctx = makeCtx();
    expectInvalid(
      mapFetchError(ctx, new TypeError('Failed to fetch')),
      'UNAVAILABLE',
      'outlook: connection failed',
    );
  });

  it('maps unknown Error by message', () => {
    const ctx = makeCtx();
    expect(getStatus(mapFetchError(ctx, new Error('Something went wrong'))).message)
      .toBe('outlook: Something went wrong');
  });

  it('maps non-Error unknown to string representation', () => {
    const ctx = makeCtx();
    const result = mapFetchError(ctx, 'plain string error');
    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).message).toContain('plain string error');
  });
});

// ============================================================
// HTTP error integration — through inbox host function [EC-12]
// ============================================================

describe('HTTP error mapping through host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('HTTP 401 throws authentication failed error [AC-23, EC-12]', async () => {
    globalThis.fetch = mockHttpError(401);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'AUTH', 'outlook: authentication failed (401)');
  });

  it('HTTP 403 throws insufficient permissions [AC-24, EC-12]', async () => {
    globalThis.fetch = mockHttpError(403);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'FORBIDDEN', 'insufficient permissions');
  });

  it('HTTP 404 throws not found [AC-25, EC-12]', async () => {
    globalThis.fetch = mockHttpError(404);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'NOT_FOUND', 'not found');
  });

  it('HTTP 429 throws rate limit exceeded with no retry [AC-26, EC-12]', async () => {
    globalThis.fetch = mockHttpError(429);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'RATE_LIMIT', 'outlook: rate limit exceeded');
  });

  it('HTTP 429 does not retry — fetch called exactly once [AC-26]', async () => {
    const mockFetch = mockHttpError(429);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 throws server error [EC-12]', async () => {
    globalThis.fetch = mockHttpError(500);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'UNAVAILABLE', 'outlook: server error (500)');
  });

  it('HTTP 503 throws server error [EC-12]', async () => {
    globalThis.fetch = mockHttpError(503);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'UNAVAILABLE', 'outlook: server error (503)');
  });

  it('AbortError maps to request timeout [AC-27, EC-12]', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch = mockFetchReject(abortErr);
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'TIMEOUT', 'outlook: request timeout');
  });

  it('TypeError maps to connection failed [EC-12]', async () => {
    globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'UNAVAILABLE', 'outlook: connection failed');
  });

  it('all HTTP errors produce invalid RillValues with status-mapped atoms', async () => {
    const expectations: Record<number, string> = {
      401: 'AUTH',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      429: 'RATE_LIMIT',
      500: 'UNAVAILABLE',
    };
    for (const [statusStr, atom] of Object.entries(expectations)) {
      const status = Number(statusStr);
      globalThis.fetch = mockHttpError(status);
      const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
      const ctx = createRuntimeContext();
      const result = (await getCallable(ext, 'inbox').fn({ top: 10 }, ctx)) as RillValue;
      expect(isInvalid(result), `status ${status} should be invalid`).toBe(true);
      expect(getStatus(result).code.name, `status ${status} atom`).toBe(atom);
    }
  });
});

// ============================================================
// Session token resolution errors [AC-28, EC-11]
// ============================================================

describe('session token resolution [AC-28, EC-11]', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('emits #AUTH when session token variable not found [AC-28, EC-11]', async () => {
    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'MY_OUTLOOK_TOKEN' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expectInvalid(result, 'AUTH', "outlook: session token 'MY_OUTLOOK_TOKEN' not found");
  });

  it('session token error message includes the tokenVar name [EC-11]', async () => {
    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'CUSTOM_VAR_NAME' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expect(getStatus(result as RillValue).message).toBe(
      "outlook: session token 'CUSTOM_VAR_NAME' not found",
    );
  });

  it('session token resolves successfully when variable is set in context', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [] }),
    });

    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'MY_TOKEN' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();
    ctx.variables.set('MY_TOKEN', 'bearer-value-from-session');

    const result = await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expect(isInvalid(result as RillValue)).toBe(false);
  });

  it('session token error does not call fetch [AC-28]', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'MISSING_TOKEN' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    }, makeFactoryCtx());
    const ctx = createRuntimeContext();
    await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// Cancellation via ctx.signal
// ============================================================

describe('ctx.signal cancellation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('aborting ctx.signal mid-flight yields #TIMEOUT', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn((_url: unknown, init: RequestInit | undefined) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal !== undefined && signal !== null) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as unknown as typeof globalThis.fetch;

    const ext = createOutlookExtension(BEARER_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext({ signal: controller.signal });
    const promise = getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    controller.abort();
    const result = await promise;
    expectInvalid(result, 'TIMEOUT');
  });
});
