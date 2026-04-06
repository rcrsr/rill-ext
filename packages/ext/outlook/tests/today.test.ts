/**
 * Tests for today() host function.
 * Covers: AC-11, AC-19.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRuntimeContext, type ApplicationCallable } from '@rcrsr/rill';
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

const CALENDAR_READ_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    calendar: { read: true, create: false },
  },
};

const GRAPH_EVENT_TODAY = {
  id: 'today-event-001',
  subject: 'Daily Sync',
  start: { dateTime: new Date().toISOString() },
  end: { dateTime: new Date(Date.now() + 1800000).toISOString() },
  location: { displayName: 'Virtual' },
  attendees: [],
  isOnlineMeeting: true,
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/join/abc' },
};

// ============================================================
// TESTS
// ============================================================

describe('today() host function', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // AC-11: today returns CalendarEventDict list for current UTC day
  it('returns CalendarEventDict list for current UTC day [AC-11]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_EVENT_TODAY] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'today').fn({}, ctx)) as Record<string, unknown>;

    expect(Array.isArray(result['events'])).toBe(true);
    const eventsArr = result['events'] as Record<string, unknown>[];
    expect(eventsArr).toHaveLength(1);
    expect(eventsArr[0]!['id']).toBe('today-event-001');
    expect(eventsArr[0]!['title']).toBe('Daily Sync');
    expect(eventsArr[0]!['isOnline']).toBe(true);
    expect(eventsArr[0]!['onlineUrl']).toBe('https://teams.microsoft.com/join/abc');
  });

  // AC-11: returns empty list when no events today
  it('returns empty events list when no events today [AC-11]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG);
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'today').fn({}, ctx)) as Record<string, unknown>;

    expect(result['events']).toEqual([]);
  });

  // AC-11: uses calendarView endpoint with today's UTC day bounds
  it('calls calendarView with current UTC day start and end [AC-11]', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [] }),
    });
    globalThis.fetch = mockFetch;
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG);
    const ctx = createRuntimeContext();

    // Capture the date before the call to check the URL
    const before = new Date();
    await getCallable(ext, 'today').fn({}, ctx);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('calendarView');
    expect(url).toContain('startDateTime');
    expect(url).toContain('endDateTime');

    // Verify the URL contains the correct UTC date for today
    const todayUtcDate = before.toISOString().substring(0, 10);
    expect(url).toContain(encodeURIComponent(todayUtcDate));
  });

  // AC-19: today emits outlook:calendar:read event
  it('emits outlook:calendar:read event on success [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_EVENT_TODAY] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG);
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'today').fn({}, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:calendar:read',
        subsystem: 'extension:outlook',
      })
    );
  });

  // AC-19: today event includes eventCount
  it('emits event with correct eventCount [AC-19]', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [GRAPH_EVENT_TODAY] }),
    });
    const ext = createOutlookExtension(CALENDAR_READ_CONFIG);
    const ctx = createRuntimeContext();
    const onLogEvent = vi.fn();
    ctx.callbacks.onLogEvent = onLogEvent;

    await getCallable(ext, 'today').fn({}, ctx);

    expect(onLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'outlook:calendar:read',
        eventCount: 1,
        range: 'today',
      })
    );
  });
});
