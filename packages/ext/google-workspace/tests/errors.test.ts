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
    } catch (e) {
      caught = e;
    }
    expectInvalid(caught, 'FORBIDDEN', 'google: gmail.send not enabled');
  });

  it('uses the capability name verbatim in the error message', () => {
    const ctx = makeCtx();
    let caught: unknown;
    try {
      checkCapability(ctx, false, 'drive.upload');
    } catch (e) {
      caught = e;
    }
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
  const cases: readonly {
    readonly label: string;
    readonly status: number;
    readonly service: 'gmail' | 'drive' | 'calendar';
    readonly op: string;
    readonly id?: string | undefined;
    readonly atom: string;
    readonly message: string;
  }[] = [
    // EC-14: HTTP 401 invalid token
    {
      label: '401 gmail',
      status: 401,
      service: 'gmail',
      op: 'read',
      atom: 'AUTH',
      message: 'google: invalid Gmail token',
    },
    {
      label: '401 drive',
      status: 401,
      service: 'drive',
      op: 'list',
      atom: 'AUTH',
      message: 'google: invalid Drive token',
    },
    {
      label: '401 calendar',
      status: 401,
      service: 'calendar',
      op: 'read',
      atom: 'AUTH',
      message: 'google: invalid Calendar token',
    },
    // EC-15: HTTP 403 insufficient scopes
    {
      label: '403 gmail',
      status: 403,
      service: 'gmail',
      op: 'send',
      atom: 'FORBIDDEN',
      message: 'google: insufficient Gmail scopes for send',
    },
    {
      label: '403 drive',
      status: 403,
      service: 'drive',
      op: 'download',
      atom: 'FORBIDDEN',
      message: 'google: insufficient Drive scopes for download',
    },
    {
      label: '403 calendar',
      status: 403,
      service: 'calendar',
      op: 'create',
      atom: 'FORBIDDEN',
      message: 'google: insufficient Calendar scopes for create',
    },
    // EC-16: HTTP 404 not found
    {
      label: '404 drive with id uses file noun',
      status: 404,
      service: 'drive',
      op: 'read',
      id: 'file-id-abc',
      atom: 'NOT_FOUND',
      message: "google: Drive file 'file-id-abc' not found",
    },
    {
      label: '404 gmail with id uses resource noun',
      status: 404,
      service: 'gmail',
      op: 'read',
      id: 'msg-id-xyz',
      atom: 'NOT_FOUND',
      message: "google: Gmail resource 'msg-id-xyz' not found",
    },
    {
      label: '404 calendar with id uses resource noun',
      status: 404,
      service: 'calendar',
      op: 'read',
      id: 'event-id-123',
      atom: 'NOT_FOUND',
      message: "google: Calendar resource 'event-id-123' not found",
    },
    {
      label: '404 drive without id',
      status: 404,
      service: 'drive',
      op: 'read',
      atom: 'NOT_FOUND',
      message: 'google: Drive file not found',
    },
    {
      label: '404 gmail without id',
      status: 404,
      service: 'gmail',
      op: 'read',
      atom: 'NOT_FOUND',
      message: 'google: Gmail resource not found',
    },
    // EC-17: HTTP 429 rate limit (message carries no service prefix)
    {
      label: '429 gmail',
      status: 429,
      service: 'gmail',
      op: 'search',
      atom: 'RATE_LIMIT',
      message: 'google: rate limit exceeded; retry after delay',
    },
    {
      label: '429 drive',
      status: 429,
      service: 'drive',
      op: 'list',
      atom: 'RATE_LIMIT',
      message: 'google: rate limit exceeded; retry after delay',
    },
    {
      label: '429 calendar',
      status: 429,
      service: 'calendar',
      op: 'read',
      atom: 'RATE_LIMIT',
      message: 'google: rate limit exceeded; retry after delay',
    },
    // EC-18: HTTP 5xx server error
    {
      label: '500 gmail',
      status: 500,
      service: 'gmail',
      op: 'read',
      atom: 'UNAVAILABLE',
      message: 'google: Gmail server error (500); temporarily unavailable',
    },
    {
      label: '503 drive',
      status: 503,
      service: 'drive',
      op: 'list',
      atom: 'UNAVAILABLE',
      message: 'google: Drive server error (503); temporarily unavailable',
    },
    {
      label: '599 calendar',
      status: 599,
      service: 'calendar',
      op: 'read',
      atom: 'UNAVAILABLE',
      message: 'google: Calendar server error (599); temporarily unavailable',
    },
  ];

  it.each(cases)(
    'maps $label to $atom with the exact message',
    ({ status, service, op, id, atom, message }) => {
      expectInvalid(
        mapGoogleError(makeCtx(), status, service, op, id),
        atom,
        message
      );
    }
  );
});

// ============================================================
// mapFetchError [EC-19]
// ============================================================

describe('mapFetchError', () => {
  it('maps AbortError to request timeout [EC-19]', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    expectInvalid(
      mapFetchError(makeCtx(), abortErr, 'gmail'),
      'TIMEOUT',
      'google: request timeout'
    );
  });

  it('maps TypeError to connection failed with service name', () => {
    expectInvalid(
      mapFetchError(makeCtx(), new TypeError('Failed to fetch'), 'gmail'),
      'UNAVAILABLE',
      'google: gmail connection failed'
    );
  });

  it('maps drive TypeError to drive-specific connection failed', () => {
    expect(
      getStatus(
        mapFetchError(makeCtx(), new TypeError('Failed to fetch'), 'drive')
      ).message
    ).toBe('google: drive connection failed');
  });
});
