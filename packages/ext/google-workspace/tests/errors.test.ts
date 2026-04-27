/**
 * Error mapping tests for Google Workspace extension.
 * Covers: EC-5, EC-14, EC-15, EC-16, EC-17, EC-18, EC-19.
 *
 * Post-rill-0.19: mappers return invalid `RillValue`s (not throw RuntimeError).
 */

import { describe, it, expect } from 'vitest';
import {
  createRuntimeContext,
  isInvalid,
  getStatus,
  type RillValue,
  type RuntimeContext,
} from '@rcrsr/rill';
import { mapGoogleError, mapFetchError } from '../src/errors.js';
import { checkCapability } from '../src/capabilities.js';

function makeCtx(): RuntimeContext {
  return createRuntimeContext();
}

function expectInvalid(value: unknown, atom: string, message?: string): void {
  const v = value as RillValue;
  expect(isInvalid(v)).toBe(true);
  expect(getStatus(v).code.name).toBe(atom);
  if (message !== undefined) expect(getStatus(v).message).toBe(message);
}

// ============================================================
// checkCapability [EC-5]
// ============================================================

describe('checkCapability [EC-5]', () => {
  it('emits #FORBIDDEN when flag is false', () => {
    const ctx = makeCtx();
    let caught: unknown;
    try {
      checkCapability(ctx, false, 'gmail.send');
    } catch (e) { caught = e; }
    expectInvalid(caught, 'FORBIDDEN', 'google: gmail.send not enabled');
  });

  it('uses the capability name verbatim in the error message', () => {
    const ctx = makeCtx();
    let caught: unknown;
    try {
      checkCapability(ctx, false, 'drive.upload');
    } catch (e) { caught = e; }
    expectInvalid(caught, 'FORBIDDEN', 'google: drive.upload not enabled');
  });

  it('does not throw when flag is true', () => {
    const ctx = makeCtx();
    expect(() => checkCapability(ctx, true, 'gmail.read')).not.toThrow();
  });

  it('does not throw when flag is true for any capability name', () => {
    const ctx = makeCtx();
    expect(() => checkCapability(ctx, true, 'calendar.create')).not.toThrow();
    expect(() => checkCapability(ctx, true, 'drive.delete')).not.toThrow();
  });
});

// ============================================================
// mapGoogleError [EC-14..EC-18]
// ============================================================

describe('mapGoogleError', () => {
  describe('EC-14: HTTP 401 invalid token', () => {
    it('produces "google: invalid Gmail token" for gmail service', () => {
      expectInvalid(mapGoogleError(makeCtx(), 401, 'gmail', 'read'), 'AUTH', 'google: invalid Gmail token');
    });

    it('produces "google: invalid Drive token" for drive service', () => {
      expectInvalid(mapGoogleError(makeCtx(), 401, 'drive', 'list'), 'AUTH', 'google: invalid Drive token');
    });

    it('produces "google: invalid Calendar token" for calendar service', () => {
      expectInvalid(mapGoogleError(makeCtx(), 401, 'calendar', 'read'), 'AUTH', 'google: invalid Calendar token');
    });
  });

  describe('EC-15: HTTP 403 insufficient scopes', () => {
    it('produces scope error with gmail service and operation', () => {
      expectInvalid(mapGoogleError(makeCtx(), 403, 'gmail', 'send'), 'FORBIDDEN', 'google: insufficient Gmail scopes for send');
    });

    it('produces scope error with drive service and operation', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 403, 'drive', 'download')).message).toBe(
        'google: insufficient Drive scopes for download',
      );
    });

    it('produces scope error with calendar service and operation', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 403, 'calendar', 'create')).message).toBe(
        'google: insufficient Calendar scopes for create',
      );
    });
  });

  describe('EC-16: HTTP 404 not found', () => {
    it('drive with id uses "file" noun', () => {
      expectInvalid(
        mapGoogleError(makeCtx(), 404, 'drive', 'read', 'file-id-abc'),
        'NOT_FOUND',
        "google: Drive file 'file-id-abc' not found",
      );
    });

    it('gmail with id uses "resource" noun', () => {
      expectInvalid(
        mapGoogleError(makeCtx(), 404, 'gmail', 'read', 'msg-id-xyz'),
        'NOT_FOUND',
        "google: Gmail resource 'msg-id-xyz' not found",
      );
    });

    it('calendar with id uses "resource" noun', () => {
      expectInvalid(
        mapGoogleError(makeCtx(), 404, 'calendar', 'read', 'event-id-123'),
        'NOT_FOUND',
        "google: Calendar resource 'event-id-123' not found",
      );
    });

    it('drive without id omits the id in message', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 404, 'drive', 'read')).message).toBe('google: Drive file not found');
    });

    it('gmail without id omits the id in message', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 404, 'gmail', 'read')).message).toBe('google: Gmail resource not found');
    });
  });

  describe('EC-17: HTTP 429 rate limit', () => {
    it('produces rate limit message without service prefix', () => {
      expectInvalid(
        mapGoogleError(makeCtx(), 429, 'gmail', 'search'),
        'RATE_LIMIT',
        'google: rate limit exceeded; retry after delay',
      );
    });

    it('rate limit message is identical for all services', () => {
      const a = getStatus(mapGoogleError(makeCtx(), 429, 'gmail', 'read')).message;
      const b = getStatus(mapGoogleError(makeCtx(), 429, 'drive', 'list')).message;
      const c = getStatus(mapGoogleError(makeCtx(), 429, 'calendar', 'read')).message;
      expect(a).toBe(b);
      expect(b).toBe(c);
    });
  });

  describe('EC-18: HTTP 5xx server error', () => {
    it('maps 500 to server error with status for gmail', () => {
      expectInvalid(
        mapGoogleError(makeCtx(), 500, 'gmail', 'read'),
        'UNAVAILABLE',
        'google: Gmail server error (500); temporarily unavailable',
      );
    });

    it('maps 503 to server error with status for drive', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 503, 'drive', 'list')).message).toBe(
        'google: Drive server error (503); temporarily unavailable',
      );
    });

    it('maps 599 to server error with status for calendar', () => {
      expect(getStatus(mapGoogleError(makeCtx(), 599, 'calendar', 'read')).message).toBe(
        'google: Calendar server error (599); temporarily unavailable',
      );
    });
  });

  it('all status codes produce invalid RillValues', () => {
    const expected: Record<number, string> = {
      401: 'AUTH',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      429: 'RATE_LIMIT',
      500: 'UNAVAILABLE',
      503: 'UNAVAILABLE',
    };
    for (const [s, atom] of Object.entries(expected)) {
      const status = Number(s);
      const result = mapGoogleError(makeCtx(), status, 'gmail', 'read');
      expect(isInvalid(result), `status ${status} should be invalid`).toBe(true);
      expect(getStatus(result).code.name, `status ${status} atom`).toBe(atom);
    }
  });
});

// ============================================================
// mapFetchError [EC-19]
// ============================================================

describe('mapFetchError', () => {
  it('maps AbortError to request timeout [EC-19]', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    expectInvalid(mapFetchError(makeCtx(), abortErr, 'gmail'), 'TIMEOUT', 'google: request timeout');
  });

  it('AbortError timeout message is the same for all services', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const a = getStatus(mapFetchError(makeCtx(), abortErr, 'gmail')).message;
    const b = getStatus(mapFetchError(makeCtx(), abortErr, 'drive')).message;
    expect(a).toBe(b);
    expect(a).toBe('google: request timeout');
  });

  it('maps TypeError to connection failed with service name', () => {
    expectInvalid(
      mapFetchError(makeCtx(), new TypeError('Failed to fetch'), 'gmail'),
      'UNAVAILABLE',
      'google: gmail connection failed',
    );
  });

  it('maps drive TypeError to drive-specific connection failed', () => {
    expect(getStatus(mapFetchError(makeCtx(), new TypeError('Failed to fetch'), 'drive')).message).toBe(
      'google: drive connection failed',
    );
  });

  it('all fetch error types produce invalid RillValues', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const typeErr = new TypeError('network');
    for (const error of [abortErr, typeErr]) {
      const result = mapFetchError(makeCtx(), error, 'gmail');
      expect(isInvalid(result)).toBe(true);
    }
  });
});
