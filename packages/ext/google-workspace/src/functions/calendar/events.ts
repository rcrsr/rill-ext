/**
 * calendar_events callable — list calendar events within a date/time range.
 * IR-15: calendar_events(startDate: str, endDate: str, options: dict?) → { events: list[dict] }
 * Capability: calendar.read
 * Scopes: calendar.readonly
 */
import { isDict } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { CalendarConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
import {
  CAL_BASE,
  assertIsoTimestamp,
  assertAllowedCalendarId,
} from './_shared.js';
const CAL_READ_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
/** Regex: date-only YYYY-MM-DD */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
export interface CalendarEventsDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly calendarConfig: CalendarConfig | undefined;
}
/**
 * Factory returning the calendar_events inner function.
 * BC-3: Returns { events: [] } immediately when startDate equals endDate.
 * EC-11: Validates calendarId against allowedCalendarIds.
 * EC-13: Rejects naive ISO timestamps (no timezone).
 * AC-12: Returns rill primitive dict { events: list[dict] }.
 */
export function makeCalendarEvents(deps: CalendarEventsDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const startDate = args['startDate'];
    const endDate = args['endDate'];
    if (typeof startDate !== 'string' || startDate.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: startDate must be a non-empty string');
    }
    if (typeof endDate !== 'string' || endDate.trim() === '') {
      failInput(ctx, 'invalid_arg', 'google: endDate must be a non-empty string');
    }
    // Determine if date-only or datetime, and derive timeMin/timeMax
    const startIsDateOnly = DATE_ONLY_RE.test(startDate);
    const endIsDateOnly = DATE_ONLY_RE.test(endDate);
    let timeMin: string;
    let timeMax: string;
    if (startIsDateOnly && endIsDateOnly) {
      // Derive UTC range from date-only values
      timeMin = `${startDate}T00:00:00Z`;
      timeMax = `${endDate}T00:00:00Z`;
    } else if (!startIsDateOnly && !endIsDateOnly) {
      // Both must be ISO datetimes with timezone [EC-13]
      assertIsoTimestamp(ctx, startDate, 'startDate');
      assertIsoTimestamp(ctx, endDate, 'endDate');
      timeMin = startDate;
      timeMax = endDate;
    } else {
      // Mixed: one date-only, one datetime — reject
      failInput(ctx, 'invalid_arg', 'google: startDate and endDate must both be date-only or both be ISO 8601 with timezone');
    }
    // BC-3: start equal to end → empty result, no fetch
    if (timeMin === timeMax) {
      return { events: [] } as unknown as RillValue;
    }
    // Extract options
    const options = args['options'];
    let calendarId = 'primary';
    if (options !== undefined && options !== null && isDict(options)) {
      const rawCalId = options['calendarId'];
      if (typeof rawCalId === 'string' && rawCalId.trim() !== '') {
        calendarId = rawCalId;
      }
    }
    // EC-11: Validate calendarId against allowlist
    assertAllowedCalendarId(ctx, calendarId, deps.calendarConfig);
    const path =
      `/calendars/${encodeURIComponent(calendarId)}/events` +
      `?timeMin=${encodeURIComponent(timeMin)}` +
      `&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true` +
      `&orderBy=startTime`;
    const response = await googleFetch(
      'GET',
      CAL_BASE,
      path,
      'calendar',
      'events',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      CAL_READ_SCOPES,
      undefined,
      undefined,
      undefined
    );
    // Project to rill-compatible shape [AC-12]
    const data = response as {
      items?: Array<{
        id?: string;
        summary?: string;
        start?: { dateTime?: string; date?: string; timeZone?: string };
        end?: { dateTime?: string; date?: string; timeZone?: string };
        attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
        description?: string;
        location?: string;
        status?: string;
      }>;
    } | null;
    const rawItems = data?.items ?? [];
    const events = rawItems.map((item) => ({
      id: item.id ?? '',
      summary: item.summary ?? '',
      start: item.start ?? {},
      end: item.end ?? {},
      attendees: (item.attendees ?? []).map((a) => ({
        email: a.email ?? '',
        displayName: a.displayName ?? '',
        responseStatus: a.responseStatus ?? '',
      })),
      description: item.description ?? '',
      location: item.location ?? '',
      status: item.status ?? '',
    }));
    return { events } as unknown as RillValue;
  };
}
