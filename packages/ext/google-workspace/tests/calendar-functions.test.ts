/**
 * Behavioral tests for Google Workspace calendar host functions.
 * Covers: IR-15..IR-18, AC-4, AC-12, AC-13, BC-3, BC-4,
 *         EC-11, EC-13, EC-14..EC-18.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRuntimeContext,
  emitExtensionEvent,
  type ApplicationCallable,
  isInvalid,
  getStatus,
  type RillValue,
} from '@rcrsr/rill';
import { makeFactoryCtx } from './_helpers.js';
import { createGoogleWorkspaceExtension } from '../src/factory.js';

// ============================================================
// MODULE MOCKS
// ============================================================

// Mock resolveToken so no real JWT/OAuth exchange happens
vi.mock('../src/auth/resolve.js', () => ({
  resolveToken: vi.fn(),
  createTokenCache: vi.fn(() => ({ slot: null })),
  clearTokenCache: vi.fn(),
}));

// Mock emitExtensionEvent to capture event emissions [AC-13]
vi.mock('@rcrsr/rill', async () => {
  const actual = await vi.importActual('@rcrsr/rill');
  return {
    ...actual,
    emitExtensionEvent: vi.fn(),
  };
});

import { resolveToken } from '../src/auth/resolve.js';

const mockResolveToken = vi.mocked(resolveToken);
const mockEmitEvent = vi.mocked(emitExtensionEvent);

// ============================================================
// HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function makeFetchError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
  });
}

// ============================================================
// FIXTURES
// ============================================================

/** All capabilities enabled. */
const ALL_CAPS_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    gmail: {
      read: true,
      search: true,
      send: true,
      draft: true,
      reply: true,
      label: true,
      modify: true,
    },
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
    calendar: {
      read: true,
      create: true,
      update: true,
      delete: true,
      freeBusy: true,
    },
  },
};

/** Calendar capabilities disabled. */
const NO_CAL_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    gmail: {
      read: true,
      search: true,
      send: true,
      draft: true,
      reply: true,
      label: true,
      modify: true,
    },
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
    calendar: {
      read: false,
      create: false,
      update: false,
      delete: false,
      freeBusy: false,
    },
  },
};

/** allowedCalendarIds restricts to 'primary' only. */
const ALLOWED_CAL_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    gmail: {
      read: true,
      search: true,
      send: true,
      draft: true,
      reply: true,
      label: true,
      modify: true,
    },
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
    calendar: {
      read: true,
      create: true,
      update: true,
      delete: true,
      freeBusy: true,
    },
  },
  calendar: { allowedCalendarIds: ['primary'] },
};

/** denyAllDay blocks all-day event creation. */
const DENY_ALLDAY_CONFIG = {
  auth: { type: 'bearer' as const, token: 'test-token' },
  capabilities: {
    gmail: {
      read: true,
      search: true,
      send: true,
      draft: true,
      reply: true,
      label: true,
      modify: true,
    },
    drive: {
      read: true,
      list: true,
      upload: true,
      download: true,
      share: true,
      delete: true,
    },
    calendar: {
      read: true,
      create: true,
      update: true,
      delete: true,
      freeBusy: true,
    },
  },
  calendar: { denyAllDay: true },
};

const SAMPLE_EVENT_ITEM = {
  id: 'evt-abc',
  summary: 'Team Standup',
  start: { dateTime: '2026-04-01T09:00:00Z' },
  end: { dateTime: '2026-04-01T09:30:00Z' },
  attendees: [
    { email: 'a@x.com', displayName: 'Alice', responseStatus: 'accepted' },
  ],
  description: 'Daily sync',
  location: 'Zoom',
  status: 'confirmed',
};

// Timezone-aware timestamps for create_event / free_busy tests
const START_Z = '2026-04-26T10:00:00Z';
const END_Z = '2026-04-26T11:00:00Z';
const START_PLUS = '2026-04-26T10:00:00+02:00';
const END_PLUS = '2026-04-26T11:00:00+02:00';

// Naive timestamps (no tz) — must be rejected
const START_NAIVE = '2026-04-26T10:00:00';
const END_NAIVE = '2026-04-26T11:00:00';

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveToken.mockResolvedValue('resolved-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// AC-4: Capability gating — calendar.read not enabled
// ============================================================

describe('AC-4: capability gating', () => {
  it('calendar_events with calendar.read:false → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(NO_CAL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-01', end_date: '2026-04-30' },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('calendar.read');
    expect(getStatus(caught).message).toContain('not enabled');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_today with calendar.read:false → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(NO_CAL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_today').fn(
      {},
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('calendar.read');
    expect(getStatus(caught).message).toContain('not enabled');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_create_event with calendar.create:false → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(NO_CAL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('calendar.create');
    expect(getStatus(caught).message).toContain('not enabled');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_free_busy with calendar.freeBusy:false → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ calendars: {} });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(NO_CAL_CONFIG, makeFactoryCtx());
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('calendar.freeBusy');
    expect(getStatus(caught).message).toContain('not enabled');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// BC-3: calendar_events with start == end → { events: [] }, no fetch
// ============================================================

describe('BC-3: start equals end returns empty without fetch', () => {
  it('date-only start==end → { events: [] } without fetch', async () => {
    const mockFetch = makeFetchOk({ items: [SAMPLE_EVENT_ITEM] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-26', end_date: '2026-04-26' },
      ctx
    )) as { events: unknown[] };

    expect(result).toEqual({ events: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('datetime start==end (UTC) → { events: [] } without fetch', async () => {
    const mockFetch = makeFetchOk({ items: [SAMPLE_EVENT_ITEM] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-26T10:00:00Z', end_date: '2026-04-26T10:00:00Z' },
      ctx
    )) as { events: unknown[] };

    expect(result).toEqual({ events: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// BC-4: calendar_free_busy empty emails → #INVALID_INPUT before fetch
// ============================================================

describe('BC-4: empty emails list rejected before fetch', () => {
  it('empty array → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ calendars: {} });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: [], start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('non-array emails → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ calendars: {} });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: 'a@x.com', start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// EC-11: allowedCalendarIds validation
// ============================================================

describe('EC-11: allowedCalendarIds restriction', () => {
  it('calendar_events with disallowed calendarId → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALLOWED_CAL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_events').fn(
      {
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        options: { calendar_id: 'other-cal' },
      },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain(
      "calendar 'other-cal' not in allowed set"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_events with allowed calendarId "primary" → proceeds to fetch', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALLOWED_CAL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'calendar_events').fn(
      {
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        options: { calendar_id: 'primary' },
      },
      ctx
    )) as { events: unknown[] };

    expect(result).toHaveProperty('events');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('calendar_events with default calendarId (primary) proceeds when primary is allowed', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALLOWED_CAL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    // No calendarId in options — defaults to 'primary'
    const result = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-01', end_date: '2026-04-30' },
      ctx
    )) as { events: unknown[] };

    expect(result).toHaveProperty('events');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('calendar_today with disallowed calendarId → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ items: [] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALLOWED_CAL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_today').fn(
      { options: { calendar_id: 'other-cal' } },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain(
      "calendar 'other-cal' not in allowed set"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_create_event with disallowed calendarId → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALLOWED_CAL_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      {
        title: 'Meeting',
        start_time: START_Z,
        end_time: END_Z,
        options: { calendar_id: 'other-cal' },
      },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain(
      "calendar 'other-cal' not in allowed set"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// EC-12/EC-13: denyAllDay validation
// ============================================================

describe('EC-12/EC-13: denyAllDay blocks all-day events', () => {
  it('allDay:true with denyAllDay config → #FORBIDDEN before fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      DENY_ALLDAY_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      {
        title: 'Holiday',
        start_time: START_Z,
        end_time: END_Z,
        options: { all_day: true },
      },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toBe(
      'google: all-day events not permitted'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// EC-13: Naive ISO timestamp validation
// ============================================================

describe('EC-13: naive ISO timestamp rejection', () => {
  it('calendar_create_event with naive startTime → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_NAIVE, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(
      'must be ISO 8601 with timezone'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_create_event with naive endTime → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_Z, end_time: END_NAIVE },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(
      'must be ISO 8601 with timezone'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_create_event with UTC Z timestamps proceeds to fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-1' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_Z, end_time: END_Z },
      ctx
    );

    expect(result).toBe('evt-1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('calendar_create_event with +02:00 offset timestamps proceeds to fetch', async () => {
    const mockFetch = makeFetchOk({ id: 'evt-2' });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_PLUS, end_time: END_PLUS },
      ctx
    );

    expect(result).toBe('evt-2');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('calendar_free_busy with naive startTime → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ calendars: {} });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_NAIVE, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(
      'must be ISO 8601 with timezone'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_free_busy with naive endTime → #INVALID_INPUT before fetch', async () => {
    const mockFetch = makeFetchOk({ calendars: {} });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_Z, end_time: END_NAIVE },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('INVALID_INPUT');
    expect(getStatus(caught).message).toContain(
      'must be ISO 8601 with timezone'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calendar_events with date-only strings are accepted (no tz required)', async () => {
    const mockFetch = makeFetchOk({ items: [SAMPLE_EVENT_ITEM] });
    vi.stubGlobal('fetch', mockFetch);

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const result = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-01', end_date: '2026-04-30' },
      ctx
    )) as { events: unknown[] };

    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ============================================================
// Success cases [IR-15..IR-18, AC-12, AC-13]
// ============================================================

describe('success cases', () => {
  describe('calendar_events [IR-15]', () => {
    it('returns { events: [...] } with rill primitives [AC-12]', async () => {
      const mockFetch = makeFetchOk({ items: [SAMPLE_EVENT_ITEM] });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_events').fn(
        { start_date: '2026-04-01', end_date: '2026-04-30' },
        ctx
      )) as { events: Array<Record<string, unknown>> };

      expect(result).toHaveProperty('events');
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.events).toHaveLength(1);

      const evt = result.events[0]!;
      expect(evt['id']).toBe('evt-abc');
      expect(evt['summary']).toBe('Team Standup');
      expect(evt['description']).toBe('Daily sync');
      expect(evt['location']).toBe('Zoom');
      expect(evt['status']).toBe('confirmed');
      // No vendor types — just plain strings/objects
      expect(typeof evt['id']).toBe('string');
    });

    it('emits google:calendar:events event with duration [AC-13]', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ items: [] }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_events').fn(
        { start_date: '2026-04-01', end_date: '2026-04-30' },
        ctx
      );

      expect(mockEmitEvent).toHaveBeenCalledOnce();
      const [emittedCtx, emittedPayload] = mockEmitEvent.mock.calls[0]!;
      expect(emittedCtx).toBe(ctx);
      expect(emittedPayload.event).toBe('google:calendar:events');
      expect(typeof emittedPayload.duration).toBe('number');
    });

    it('makes GET request to /calendars/primary/events', async () => {
      const mockFetch = makeFetchOk({ items: [] });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_events').fn(
        { start_date: '2026-04-01', end_date: '2026-04-30' },
        ctx
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/calendars/primary/events');
      expect((init as Record<string, string>)['method'] ?? 'GET').toBe('GET');
    });

    it('returns empty events list when API returns no items', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ items: [] }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_events').fn(
        { start_date: '2026-04-01', end_date: '2026-04-30' },
        ctx
      )) as { events: unknown[] };

      expect(result.events).toHaveLength(0);
    });
  });

  describe('calendar_today [IR-16]', () => {
    it('returns { events: [...] } from API response [AC-12]', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ items: [SAMPLE_EVENT_ITEM] }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_today').fn({}, ctx)) as {
        events: unknown[];
      };

      expect(result).toHaveProperty('events');
      expect(result.events).toHaveLength(1);
    });

    it('emits google:calendar:today event with duration [AC-13]', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ items: [] }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_today').fn({}, ctx);

      expect(mockEmitEvent).toHaveBeenCalledOnce();
      const [, payload] = mockEmitEvent.mock.calls[0]!;
      expect(payload.event).toBe('google:calendar:today');
      expect(typeof payload.duration).toBe('number');
    });

    it('makes GET request for today primary calendar', async () => {
      const mockFetch = makeFetchOk({ items: [] });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_today').fn({}, ctx);

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/calendars/primary/events');
      expect(url).toContain('singleEvents=true');
    });
  });

  describe('calendar_create_event [IR-17]', () => {
    it('returns event ID string from API response [AC-12]', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ id: 'evt-1' }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'calendar_create_event').fn(
        { title: 'Team Meeting', start_time: START_Z, end_time: END_Z },
        ctx
      );

      expect(result).toBe('evt-1');
      expect(typeof result).toBe('string');
    });

    it('emits google:calendar:create_event event with duration [AC-13]', async () => {
      vi.stubGlobal('fetch', makeFetchOk({ id: 'evt-1' }));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_create_event').fn(
        { title: 'Meeting', start_time: START_Z, end_time: END_Z },
        ctx
      );

      expect(mockEmitEvent).toHaveBeenCalledOnce();
      const [, payload] = mockEmitEvent.mock.calls[0]!;
      expect(payload.event).toBe('google:calendar:create_event');
      expect(typeof payload.duration).toBe('number');
    });

    it('makes POST request to /calendars/primary/events', async () => {
      const mockFetch = makeFetchOk({ id: 'evt-1' });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_create_event').fn(
        { title: 'Meeting', start_time: START_Z, end_time: END_Z },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/calendars/primary/events');
      expect(init.method).toBe('POST');
    });

    it('POST URL contains sendUpdates= and not sendNotifications', async () => {
      const mockFetch = makeFetchOk({ id: 'evt-1' });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_create_event').fn(
        { title: 'Meeting', start_time: START_Z, end_time: END_Z },
        ctx
      );

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('sendUpdates=');
      expect(url).not.toContain('sendNotifications');
    });

    it('returns empty string when API returns no id', async () => {
      vi.stubGlobal('fetch', makeFetchOk({}));

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = await getCallable(ext, 'calendar_create_event').fn(
        { title: 'Meeting', start_time: START_Z, end_time: END_Z },
        ctx
      );

      expect(result).toBe('');
    });
  });

  describe('calendar_free_busy [IR-18]', () => {
    it('returns dict keyed by email with busy slots [AC-12]', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchOk({
          calendars: {
            'a@x.com': {
              busy: [
                { start: '2026-04-26T10:00:00Z', end: '2026-04-26T11:00:00Z' },
              ],
            },
          },
        })
      );

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_free_busy').fn(
        { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
        ctx
      )) as Record<string, { busy: Array<{ start: string; end: string }> }>;

      expect(result).toHaveProperty('a@x.com');
      const busy = result['a@x.com']!.busy;
      expect(busy).toHaveLength(1);
      expect(busy[0]!.start).toBe('2026-04-26T10:00:00Z');
      expect(busy[0]!.end).toBe('2026-04-26T11:00:00Z');
    });

    it('emits google:calendar:free_busy event with duration [AC-13]', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchOk({ calendars: { 'a@x.com': { busy: [] } } })
      );

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_free_busy').fn(
        { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
        ctx
      );

      expect(mockEmitEvent).toHaveBeenCalledOnce();
      const [, payload] = mockEmitEvent.mock.calls[0]!;
      expect(payload.event).toBe('google:calendar:free_busy');
      expect(typeof payload.duration).toBe('number');
    });

    it('makes POST request to /freeBusy', async () => {
      const mockFetch = makeFetchOk({ calendars: {} });
      vi.stubGlobal('fetch', mockFetch);

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      await getCallable(ext, 'calendar_free_busy').fn(
        { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
        ctx
      );

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/freeBusy');
      expect(init.method).toBe('POST');
    });

    it('returns empty busy list when calendar has no busy slots', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchOk({ calendars: { 'a@x.com': { busy: [] } } })
      );

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_free_busy').fn(
        { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
        ctx
      )) as Record<string, { busy: unknown[] }>;

      expect(result['a@x.com']!.busy).toHaveLength(0);
    });

    it('returns multiple email entries in result dict', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchOk({
          calendars: {
            'a@x.com': { busy: [{ start: START_Z, end: END_Z }] },
            'b@x.com': { busy: [] },
          },
        })
      );

      const ext = createGoogleWorkspaceExtension(
        ALL_CAPS_CONFIG,
        makeFactoryCtx()
      );
      const ctx = createRuntimeContext();

      const result = (await getCallable(ext, 'calendar_free_busy').fn(
        {
          emails: ['a@x.com', 'b@x.com'],
          start_time: START_Z,
          end_time: END_Z,
        },
        ctx
      )) as Record<string, unknown>;

      expect(Object.keys(result)).toContain('a@x.com');
      expect(Object.keys(result)).toContain('b@x.com');
    });
  });
});

// ============================================================
// Integration depth: AC-13 subsystem field verification
// ============================================================

describe('AC-13: calendar events include subsystem field', () => {
  it('calendar_events emits subsystem extension:google-workspace', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ items: [] }));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-01', end_date: '2026-04-30' },
      ctx
    );

    // mockEmitEvent is the vi.mocked(emitExtensionEvent) from the module mock
    expect(mockEmitEvent).toHaveBeenCalledOnce();
    const [, payload] = mockEmitEvent.mock.calls[0]!;
    expect(payload.subsystem).toBe('extension:google-workspace');
    expect(payload.event).toBe('google:calendar:events');
  });

  it('calendar_create_event emits subsystem extension:google-workspace', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ id: 'evt-1' }));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_Z, end_time: END_Z },
      ctx
    );

    const [, payload] = mockEmitEvent.mock.calls[0]!;
    expect(payload.subsystem).toBe('extension:google-workspace');
  });

  it('calendar_free_busy emits subsystem extension:google-workspace', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchOk({ calendars: { 'a@x.com': { busy: [] } } })
    );

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
      ctx
    );

    const [, payload] = mockEmitEvent.mock.calls[0]!;
    expect(payload.subsystem).toBe('extension:google-workspace');
  });

  it('calendar_today emits subsystem extension:google-workspace', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ items: [] }));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_today').fn({}, ctx);

    const [, payload] = mockEmitEvent.mock.calls[0]!;
    expect(payload.subsystem).toBe('extension:google-workspace');
  });
});

// ============================================================
// Integration depth: AC-11 AbortSignal verification
// ============================================================

describe('AC-11: calendar callables pass AbortSignal to fetch', () => {
  it('calendar_today passes a combined AbortSignal instance [AC-11]', async () => {
    let capturedSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [] }),
        });
      })
    );

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_today').fn({}, ctx);

    // AC-11: signal must be an AbortSignal instance (combined controller + 30s timeout)
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('calendar_free_busy passes a combined AbortSignal instance [AC-11]', async () => {
    let capturedSignal: AbortSignal | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ calendars: {} }),
        });
      })
    );

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
      ctx
    );

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });
});

// ============================================================
// HTTP error mapping [EC-14..EC-18]
// ============================================================

describe('HTTP error mapping for calendar operations', () => {
  it('401 → "google: invalid Calendar token" [EC-14]', async () => {
    vi.stubGlobal('fetch', makeFetchError(401));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_events').fn(
      { start_date: '2026-04-01', end_date: '2026-04-30' },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('AUTH');
    expect(getStatus(caught).message).toBe('google: invalid Calendar token');
  });

  it('403 → "google: insufficient Calendar scopes for <op>" [EC-15]', async () => {
    vi.stubGlobal('fetch', makeFetchError(403));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_create_event').fn(
      { title: 'Meeting', start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('FORBIDDEN');
    expect(getStatus(caught).message).toContain('insufficient Calendar scopes');
    expect(getStatus(caught).message).toContain('create_event');
  });

  it('429 → rate limit error [EC-17]', async () => {
    vi.stubGlobal('fetch', makeFetchError(429));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_today').fn(
      {},
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('RATE_LIMIT');
    expect(getStatus(caught).message).toBe(
      'google: rate limit exceeded; retry after delay'
    );
  });

  it('503 → "google: Calendar server error (503); temporarily unavailable" [EC-18]', async () => {
    vi.stubGlobal('fetch', makeFetchError(503));

    const ext = createGoogleWorkspaceExtension(
      ALL_CAPS_CONFIG,
      makeFactoryCtx()
    );
    const ctx = createRuntimeContext();

    const caught = (await getCallable(ext, 'calendar_free_busy').fn(
      { emails: ['a@x.com'], start_time: START_Z, end_time: END_Z },
      ctx
    )) as RillValue;
    expect(isInvalid(caught)).toBe(true);
    expect(getStatus(caught).code.name).toBe('UNAVAILABLE');
    expect(getStatus(caught).message).toBe(
      'google: Calendar server error (503); temporarily unavailable'
    );
  });
});
