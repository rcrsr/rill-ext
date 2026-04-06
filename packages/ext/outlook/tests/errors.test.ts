/**
 * Error mapping tests for Outlook extension.
 * Mocks fetch to trigger HTTP and network errors through a live host function call.
 * Also tests session token resolution failures.
 * Covers: AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, EC-11, EC-12.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RuntimeError, createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
import { createOutlookExtension } from '../src/factory.js';
import { mapGraphError, mapFetchError } from '../src/errors.js';

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(ext: { value: unknown }, name: string): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
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
  // Enable all capabilities for unrestricted testing
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
    const err = mapGraphError(401, 'inbox');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: authentication failed (401)');
  });

  it('maps 403 to insufficient permissions with operation [AC-24, EC-12]', () => {
    const err = mapGraphError(403, 'send');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: insufficient permissions for send');
  });

  it('maps 403 with different operation names', () => {
    expect(mapGraphError(403, 'read').message).toContain('read');
    expect(mapGraphError(403, 'calendar/events').message).toContain('calendar/events');
  });

  it('maps 404 to message not found with id [AC-25, EC-12]', () => {
    const err = mapGraphError(404, 'read', 'msg-abc-123');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe("outlook: message 'msg-abc-123' not found");
  });

  it('maps 404 without id uses operation as identifier [AC-25]', () => {
    const err = mapGraphError(404, 'inbox/msg-xyz');
    expect(err.message).toContain("not found");
  });

  it('maps 429 to rate limit exceeded with no retry message [AC-26, EC-12]', () => {
    const err = mapGraphError(429, 'inbox');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: rate limit exceeded');
  });

  it('maps 500 to server error', () => {
    const err = mapGraphError(500, 'inbox');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: server error (500)');
  });

  it('maps 503 to server error', () => {
    const err = mapGraphError(503, 'inbox');
    expect(err.message).toBe('outlook: server error (503)');
  });

  it('maps 599 to server error', () => {
    const err = mapGraphError(599, 'inbox');
    expect(err.message).toBe('outlook: server error (599)');
  });

  it('maps unknown status to generic failed message', () => {
    const err = mapGraphError(418, 'inbox');
    expect(err.message).toBe('outlook: request failed (418)');
  });
});

// ============================================================
// mapFetchError unit tests [EC-12]
// ============================================================

describe('mapFetchError', () => {
  it('maps AbortError to request timeout [AC-27, EC-12]', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const err = mapFetchError(abortErr);
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: request timeout');
  });

  it('maps TypeError to connection failed [EC-12]', () => {
    const err = mapFetchError(new TypeError('Failed to fetch'));
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('outlook: connection failed');
  });

  it('passes through existing RuntimeError unchanged', () => {
    const rillErr = new RuntimeError('RILL-R004', 'outlook: already mapped');
    const result = mapFetchError(rillErr);
    expect(result).toBe(rillErr);
    expect(result.message).toBe('outlook: already mapped');
  });

  it('maps unknown Error by message', () => {
    const err = mapFetchError(new Error('Something went wrong'));
    expect(err.message).toBe('outlook: Something went wrong');
  });

  it('maps non-Error unknown to string representation', () => {
    const err = mapFetchError('plain string error');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.message).toContain('plain string error');
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
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toBe('outlook: authentication failed (401)');
  });

  it('HTTP 403 throws insufficient permissions [AC-24, EC-12]', async () => {
    globalThis.fetch = mockHttpError(403);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toContain('insufficient permissions');
  });

  it('HTTP 404 throws not found [AC-25, EC-12]', async () => {
    globalThis.fetch = mockHttpError(404);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toContain('not found');
  });

  it('HTTP 429 throws rate limit exceeded with no retry [AC-26, EC-12]', async () => {
    globalThis.fetch = mockHttpError(429);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toBe('outlook: rate limit exceeded');
  });

  it('HTTP 429 does not retry — fetch called exactly once [AC-26]', async () => {
    const mockFetch = mockHttpError(429);
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch {
      // expected
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 throws server error [EC-12]', async () => {
    globalThis.fetch = mockHttpError(500);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toBe('outlook: server error (500)');
  });

  it('HTTP 503 throws server error [EC-12]', async () => {
    globalThis.fetch = mockHttpError(503);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toBe('outlook: server error (503)');
  });

  it('AbortError maps to request timeout [AC-27, EC-12]', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch = mockFetchReject(abortErr);
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toBe('outlook: request timeout');
  });

  it('TypeError maps to connection failed [EC-12]', async () => {
    globalThis.fetch = mockFetchReject(new TypeError('Failed to fetch'));
    const ext = createOutlookExtension(BEARER_CONFIG);
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).message).toBe('outlook: connection failed');
  });

  it('all HTTP errors produce RILL-R004 errorId', async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      globalThis.fetch = mockHttpError(status);
      const ext = createOutlookExtension(BEARER_CONFIG);
      const ctx = createRuntimeContext();

      let caught: unknown;
      try {
        await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
      } catch (e) {
        caught = e;
      }

      expect(caught, `status ${status} should produce RILL-R004`).toBeInstanceOf(RuntimeError);
      expect(
        (caught as RuntimeError).errorId,
        `status ${status} errorId`
      ).toBe('RILL-R004');
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

  it('throws RILL-R004 when session token variable not found in context [AC-28, EC-11]', async () => {
    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'MY_OUTLOOK_TOKEN' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    });
    // Empty context: no variables set
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toBe(
      "outlook: session token 'MY_OUTLOOK_TOKEN' not found"
    );
  });

  it('session token error message includes the tokenVar name [EC-11]', async () => {
    const ext = createOutlookExtension({
      auth: { type: 'session', tokenVar: 'CUSTOM_VAR_NAME' },
      capabilities: {
        mail: { read: true, send: true, draft: true, flag: true, search: true },
        calendar: { read: true, create: true },
      },
    });
    const ctx = createRuntimeContext();

    let caught: unknown;
    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch (e) {
      caught = e;
    }

    expect((caught as RuntimeError).message).toBe(
      "outlook: session token 'CUSTOM_VAR_NAME' not found"
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
    });
    const ctx = createRuntimeContext();
    ctx.variables.set('MY_TOKEN', 'bearer-value-from-session');

    await expect(
      getCallable(ext, 'inbox').fn({ top: 10 }, ctx)
    ).resolves.toBeDefined();
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
    });
    const ctx = createRuntimeContext();

    try {
      await getCallable(ext, 'inbox').fn({ top: 10 }, ctx);
    } catch {
      // expected
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
