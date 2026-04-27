/**
 * Error mapping tests for Google Workspace extension.
 * Covers: EC-5, EC-14, EC-15, EC-16, EC-17, EC-18, EC-19.
 * Note: EC-20 (operation cancelled via dispose) is deferred to Phase 2.5 / 4.3.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { mapGoogleError, mapFetchError } from '../src/errors.js';
import { checkCapability } from '../src/capabilities.js';

// ============================================================
// checkCapability [EC-5]
// ============================================================

describe('checkCapability [EC-5]', () => {
  it('throws RILL-R004 with "not enabled" message when flag is false', () => {
    let caught: unknown;
    try {
      checkCapability(false, 'gmail.send');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toBe('google: gmail.send not enabled');
  });

  it('uses the capability name verbatim in the error message', () => {
    let caught: unknown;
    try {
      checkCapability(false, 'drive.upload');
    } catch (e) {
      caught = e;
    }
    expect((caught as RuntimeError).message).toBe('google: drive.upload not enabled');
  });

  it('does not throw when flag is true', () => {
    expect(() => checkCapability(true, 'gmail.read')).not.toThrow();
  });

  it('does not throw when flag is true for any capability name', () => {
    expect(() => checkCapability(true, 'calendar.create')).not.toThrow();
    expect(() => checkCapability(true, 'drive.delete')).not.toThrow();
  });
});

// ============================================================
// mapGoogleError [EC-14..EC-18]
// ============================================================

describe('mapGoogleError', () => {
  // ============================================================
  // EC-14: 401 — invalid token, service prefix capitalized
  // ============================================================

  describe('EC-14: HTTP 401 invalid token', () => {
    it('produces "google: invalid Gmail token" for gmail service', () => {
      const err = mapGoogleError(401, 'gmail', 'read');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: invalid Gmail token');
    });

    it('produces "google: invalid Drive token" for drive service', () => {
      const err = mapGoogleError(401, 'drive', 'list');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: invalid Drive token');
    });

    it('produces "google: invalid Calendar token" for calendar service', () => {
      const err = mapGoogleError(401, 'calendar', 'read');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: invalid Calendar token');
    });
  });

  // ============================================================
  // EC-15: 403 — insufficient scopes with operation name
  // ============================================================

  describe('EC-15: HTTP 403 insufficient scopes', () => {
    it('produces scope error with gmail service and operation', () => {
      const err = mapGoogleError(403, 'gmail', 'send');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: insufficient Gmail scopes for send');
    });

    it('produces scope error with drive service and operation', () => {
      const err = mapGoogleError(403, 'drive', 'download');
      expect(err.message).toBe('google: insufficient Drive scopes for download');
    });

    it('produces scope error with calendar service and operation', () => {
      const err = mapGoogleError(403, 'calendar', 'create');
      expect(err.message).toBe('google: insufficient Calendar scopes for create');
    });
  });

  // ============================================================
  // EC-16: 404 — drive uses "file", gmail/calendar use "resource"
  // ============================================================

  describe('EC-16: HTTP 404 not found', () => {
    it('drive with id uses "file" noun', () => {
      const err = mapGoogleError(404, 'drive', 'read', 'file-id-abc');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe("google: Drive file 'file-id-abc' not found");
    });

    it('gmail with id uses "resource" noun', () => {
      const err = mapGoogleError(404, 'gmail', 'read', 'msg-id-xyz');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe("google: Gmail resource 'msg-id-xyz' not found");
    });

    it('calendar with id uses "resource" noun', () => {
      const err = mapGoogleError(404, 'calendar', 'read', 'event-id-123');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe("google: Calendar resource 'event-id-123' not found");
    });

    it('drive without id omits the id in message', () => {
      const err = mapGoogleError(404, 'drive', 'read');
      expect(err.message).toBe('google: Drive file not found');
    });

    it('gmail without id omits the id in message', () => {
      const err = mapGoogleError(404, 'gmail', 'read');
      expect(err.message).toBe('google: Gmail resource not found');
    });
  });

  // ============================================================
  // EC-17: 429 — no service prefix
  // ============================================================

  describe('EC-17: HTTP 429 rate limit', () => {
    it('produces rate limit message without service prefix', () => {
      const err = mapGoogleError(429, 'gmail', 'search');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: rate limit exceeded; retry after delay');
    });

    it('rate limit message is identical for all services', () => {
      const gmailErr = mapGoogleError(429, 'gmail', 'read');
      const driveErr = mapGoogleError(429, 'drive', 'list');
      const calendarErr = mapGoogleError(429, 'calendar', 'read');
      expect(gmailErr.message).toBe(driveErr.message);
      expect(driveErr.message).toBe(calendarErr.message);
    });
  });

  // ============================================================
  // EC-18: 5xx — server error with status code
  // ============================================================

  describe('EC-18: HTTP 5xx server error', () => {
    it('maps 500 to server error with status for gmail', () => {
      const err = mapGoogleError(500, 'gmail', 'read');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
      expect(err.message).toBe('google: Gmail server error (500); temporarily unavailable');
    });

    it('maps 503 to server error with status for drive', () => {
      const err = mapGoogleError(503, 'drive', 'list');
      expect(err.message).toBe('google: Drive server error (503); temporarily unavailable');
    });

    it('maps 599 to server error with status for calendar', () => {
      const err = mapGoogleError(599, 'calendar', 'read');
      expect(err.message).toBe('google: Calendar server error (599); temporarily unavailable');
    });
  });

  // ============================================================
  // All mapped errors are RILL-R004 RuntimeError
  // ============================================================

  it('all status codes produce RuntimeError with RILL-R004', () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const err = mapGoogleError(status, 'gmail', 'read');
      expect(err, `status ${status} should be RuntimeError`).toBeInstanceOf(RuntimeError);
      expect((err as RuntimeError).errorId, `status ${status} errorId`).toBe('RILL-R004');
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
    const err = mapFetchError(abortErr, 'gmail');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('google: request timeout');
  });

  it('AbortError timeout message is the same for all services', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const gmailErr = mapFetchError(abortErr, 'gmail');
    const driveErr = mapFetchError(abortErr, 'drive');
    expect(gmailErr.message).toBe(driveErr.message);
    expect(gmailErr.message).toBe('google: request timeout');
  });

  it('maps TypeError to connection failed with service name', () => {
    const err = mapFetchError(new TypeError('Failed to fetch'), 'gmail');
    expect(err).toBeInstanceOf(RuntimeError);
    expect(err.errorId).toBe('RILL-R004');
    expect(err.message).toBe('google: gmail connection failed');
  });

  it('maps drive TypeError to drive-specific connection failed', () => {
    const err = mapFetchError(new TypeError('Failed to fetch'), 'drive');
    expect(err.message).toBe('google: drive connection failed');
  });

  it('passes through existing RuntimeError unchanged', () => {
    const rillErr = new RuntimeError('RILL-R004', 'google: already mapped');
    const result = mapFetchError(rillErr, 'gmail');
    expect(result).toBe(rillErr);
    expect(result.message).toBe('google: already mapped');
  });

  it('all fetch error types produce RILL-R004', () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const typeErr = new TypeError('network');
    for (const error of [abortErr, typeErr]) {
      const err = mapFetchError(error, 'gmail');
      expect(err).toBeInstanceOf(RuntimeError);
      expect(err.errorId).toBe('RILL-R004');
    }
  });
});
