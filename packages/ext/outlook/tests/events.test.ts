/**
 * Tests for events(), reply(), flag(), free_busy(), and create_event() host functions.
 * Covers: AC-8, AC-9, AC-10, AC-12, AC-13, AC-19, AC-34, AC-35, EC-6, EC-8, EC-9, EC-10.
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

// ============================================================
// FIXTURES
// ============================================================

/** Config with mail.send enabled for reply tests. */
const REPLY_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    mail: { read: true, send: true, draft: true, flag: true, search: true },
  },
};

/** Config with mail.flag enabled (default) for flag tests. */
const FLAG_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    mail: { read: true, send: false, draft: true, flag: true, search: true },
  },
};

/** Config with calendar.read enabled (default) for events/free_busy tests. */
const CALENDAR_READ_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    calendar: { read: true, create: false },
  },
};

/** Config with calendar.create enabled for create_event tests. */
const CALENDAR_CREATE_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    calendar: { read: true, create: true },
  },
};

// Epoch ms fixtures: 2025-01-15T00:00:00.000Z and 2025-01-15T23:59:59.999Z
const DAY_START_MS = 1736899200000;
const DAY_END_MS = 1736985599999;

const GRAPH_EVENT = {
  id: 'event-001',
  subject: 'Team Standup',
  start: { dateTime: '2025-01-15T09:00:00' },
  end: { dateTime: '2025-01-15T09:30:00' },
  location: { displayName: 'Room A' },
  attendees: [{ emailAddress: { address: 'alice@example.com' } }],
  isOnlineMeeting: false,
  onlineMeeting: null,
};

const GRAPH_MESSAGE_FLAGGED = {
  id: 'msg-001',
  subject: 'Hello',
  bodyPreview: 'Preview text',
  from: { emailAddress: { address: 'sender@example.com' } },
  toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
  receivedDateTime: '2025-01-10T08:00:00Z',
  isRead: false,
  flag: { flagStatus: 'flagged' },
  hasAttachments: false,
};

const GRAPH_SCHEDULE = {
  scheduleId: 'alice@example.com',
  availabilityView: 'FFFF',
  scheduleItems: [
    {
      status: 'busy',
      subject: 'Meeting',
      start: { dateTime: '2025-01-15T10:00:00' },
      end: { dateTime: '2025-01-15T11:00:00' },
    },
  ],
};

// ============================================================
// reply() TESTS
// ============================================================

describe('reply() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-8: reply returns SendConfirmationDict
  it('returns SendConfirmationDict with sent=true [AC-8]', async () => {
    // Graph returns 202 with no body; graphFetch returns null
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const ext = createOutlookExtension(REPLY_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'reply').fn(
      { message_id: 'msg-001', body: 'Thanks for your message.' },
      ctx
    )) as Record<string, unknown>;

    expect(result['sent']).toBe(true);
    expect(Array.isArray(result['to'])).toBe(true);
    expect(result['to']).toEqual([]);
    expect(result['subject']).toBe('');
  });

  // AC-19: reply emits outlook:mail:send event
  it('emits outlook:mail:send event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const ext = createOutlookExtension(REPLY_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'reply').fn(
      { message_id: 'msg-001', body: 'Reply body.' },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:send',
        subsystem: 'extension:outlook',
      })
    );
  });

  // EC-6: empty message_id throws #INVALID_INPUT
  it('throws #INVALID_INPUT for empty message_id [EC-6]', async () => {
    const ext = createOutlookExtension(REPLY_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'reply').fn({ message_id: '', body: 'Hello' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('message_id is required');
  });

  // EC-6: empty body throws #INVALID_INPUT
  it('throws #INVALID_INPUT for empty body [EC-6]', async () => {
    const ext = createOutlookExtension(REPLY_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'reply').fn({ message_id: 'msg-001', body: '' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('body is required');
  });
});

// ============================================================
// flag() TESTS
// ============================================================

describe('flag() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-9: flag returns updated MailMessageDict with flagged=true
  it('returns updated MailMessageDict with flagged=true [AC-9]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(GRAPH_MESSAGE_FLAGGED),
    });
    const ext = createOutlookExtension(FLAG_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'flag').fn(
      { message_id: 'msg-001' },
      ctx
    )) as Record<string, unknown>;

    expect(result['id']).toBe('msg-001');
    expect(result['flagged']).toBe(true);
    expect(result['subject']).toBe('Hello');
  });

  // AC-19: flag emits outlook:mail:flag event
  it('emits outlook:mail:flag event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(GRAPH_MESSAGE_FLAGGED),
    });
    const ext = createOutlookExtension(FLAG_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'flag').fn({ message_id: 'msg-001' }, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:mail:flag',
        subsystem: 'extension:outlook',
      })
    );
  });

  // EC-6: empty message_id throws #INVALID_INPUT
  it('throws #INVALID_INPUT for empty message_id [EC-6]', async () => {
    const ext = createOutlookExtension(FLAG_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'flag').fn({ message_id: '' }, ctx)) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('message_id is required');
  });
});

// ============================================================
// events() TESTS
// ============================================================

describe('events() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-10: events returns CalendarEventDict list for date range
  it('returns CalendarEventDict list for date range [AC-10]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_EVENT] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'events').fn(
      { start: DAY_START_MS, end: DAY_END_MS },
      ctx
    )) as Record<string, unknown>;

    expect(Array.isArray(result['events'])).toBe(true);
    const eventsArr = result['events'] as Record<string, unknown>[];
    expect(eventsArr).toHaveLength(1);
    expect(eventsArr[0]!['id']).toBe('event-001');
    expect(eventsArr[0]!['title']).toBe('Team Standup');
    expect(eventsArr[0]!['location']).toBe('Room A');
    expect(typeof result['range']).toBe('string');
  });

  // AC-34: start=end returns empty list
  it('returns empty events list when start equals end [AC-34]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'events').fn(
      { start: DAY_START_MS, end: DAY_START_MS },
      ctx
    )) as Record<string, unknown>;

    expect(result['events']).toEqual([]);
  });

  // EC-8: start > end throws #INVALID_INPUT
  it('throws #INVALID_INPUT when start is after end [EC-8]', async () => {
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'events').fn(
        { start: DAY_END_MS, end: DAY_START_MS },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('start must be before end');
  });

  // AC-19: events emits outlook:calendar:read event
  it('emits outlook:calendar:read event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_EVENT] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'events').fn(
      { start: DAY_START_MS, end: DAY_END_MS },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:calendar:read',
        subsystem: 'extension:outlook',
      })
    );
  });
});

// ============================================================
// free_busy() TESTS
// ============================================================

describe('free_busy() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-12: free_busy returns FreeBusyScheduleDict list
  it('returns FreeBusyScheduleDict list [AC-12]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_SCHEDULE] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'free_busy').fn(
      { start: DAY_START_MS, end: DAY_END_MS, attendees: ['alice@example.com', 'bob@example.com'] },
      ctx
    )) as Record<string, unknown>;

    expect(Array.isArray(result['schedules'])).toBe(true);
    const schedules = result['schedules'] as Record<string, unknown>[];
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!['schedule_id']).toBe('alice@example.com');
    expect(schedules[0]!['availability']).toBe('FFFF');
    expect(typeof result['range']).toBe('string');
  });

  // AC-35: single attendee returns single-element list
  it('returns single-element schedules list for one attendee [AC-35]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_SCHEDULE] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'free_busy').fn(
      { start: DAY_START_MS, end: DAY_END_MS, attendees: ['alice@example.com'] },
      ctx
    )) as Record<string, unknown>;

    const schedules = result['schedules'] as unknown[];
    expect(schedules).toHaveLength(1);
  });

  // EC-9: empty attendees throws #INVALID_INPUT
  it('throws #INVALID_INPUT for empty attendees [EC-9]', async () => {
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'free_busy').fn(
        { start: DAY_START_MS, end: DAY_END_MS, attendees: [] },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('attendees is required');
  });

  // EC-8: start > end throws #INVALID_INPUT
  it('throws #INVALID_INPUT when start is after end [EC-8]', async () => {
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'free_busy').fn(
        { start: DAY_END_MS, end: DAY_START_MS, attendees: ['alice@example.com'] },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('start must be before end');
  });

  // AC-19: free_busy emits outlook:calendar:read event
  it('emits outlook:calendar:read event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_SCHEDULE] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'free_busy').fn(
      { start: DAY_START_MS, end: DAY_END_MS, attendees: ['alice@example.com'] },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:calendar:read',
        subsystem: 'extension:outlook',
      })
    );
  });
});

// ============================================================
// create_event() TESTS
// ============================================================

describe('create_event() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-13: create_event returns CalendarEventDict from 201
  it('returns CalendarEventDict from 201 response [AC-13]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue(GRAPH_EVENT),
    });
    const ext = createOutlookExtension(CALENDAR_CREATE_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'create_event').fn(
      { title: 'Team Standup', start: DAY_START_MS, end: DAY_END_MS },
      ctx
    )) as Record<string, unknown>;

    expect(result['id']).toBe('event-001');
    expect(result['title']).toBe('Team Standup');
    expect(result['location']).toBe('Room A');
    expect(typeof result['start']).toBe('number');
    expect(typeof result['end']).toBe('number');
  });

  // EC-10: empty title throws #INVALID_INPUT
  it('throws #INVALID_INPUT for empty title [EC-10]', async () => {
    const ext = createOutlookExtension(CALENDAR_CREATE_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'create_event').fn(
        { title: '', start: DAY_START_MS, end: DAY_END_MS },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('title is required');
  });

  // EC-10: start > end throws #INVALID_INPUT
  it('throws #INVALID_INPUT when start is after end [EC-10]', async () => {
    const ext = createOutlookExtension(CALENDAR_CREATE_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

      const caught = (await getCallable(ext, 'create_event').fn(
        { title: 'Meeting', start: DAY_END_MS, end: DAY_START_MS },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain('start must be before end');
  });

  // EC-10: calendar.create disabled emits #FORBIDDEN
  it('emits #FORBIDDEN when calendar.create is disabled [EC-10]', async () => {
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
      const caught = (await getCallable(ext, 'create_event').fn(
        { title: 'Meeting', start: DAY_START_MS, end: DAY_END_MS },
        ctx
      )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('calendar.create');
  });

  // AC-19: create_event emits outlook:calendar:create event
  it('emits outlook:calendar:create event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue(GRAPH_EVENT),
    });
    const ext = createOutlookExtension(CALENDAR_CREATE_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'create_event').fn(
      { title: 'Team Standup', start: DAY_START_MS, end: DAY_END_MS },
      ctx
    );

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:calendar:create',
        subsystem: 'extension:outlook',
      })
    );
  });
});
