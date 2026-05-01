/**
 * calendar_today callable — list calendar events for today (UTC).
 * IR-16: calendar_today(options: dict?) → { events: list[dict] }
 * Capability: calendar.read
 * Scopes: calendar.readonly
 */

import { isDict } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { CalendarConfig } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
import { CAL_BASE, assertAllowedCalendarId } from './_shared.js';

const CAL_READ_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export interface CalendarTodayDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly calendarConfig: CalendarConfig | undefined;
}

/**
 * Factory returning the calendar_today inner function.
 * Computes today's UTC range: <YYYY-MM-DD>T00:00:00Z to <YYYY-MM-DD>T23:59:59Z.
 * EC-11: Validates calendarId against allowedCalendarIds.
 * AC-12: Returns rill primitive dict { events: list[dict] }.
 */
export function makeCalendarToday(deps: CalendarTodayDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    // Compute today's UTC date string YYYY-MM-DD
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const todayDate = `${yyyy}-${mm}-${dd}`;

    const timeMin = `${todayDate}T00:00:00Z`;
    const timeMax = `${todayDate}T23:59:59Z`;

    // Extract options
    const options = args['options'];
    let calendarId = 'primary';

    if (options !== undefined && options !== null && isDict(options)) {
      const rawCalId = options['calendar_id'];
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
      'today',
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
        display_name: a.displayName ?? '',
        response_status: a.responseStatus ?? '',
      })),
      description: item.description ?? '',
      location: item.location ?? '',
      status: item.status ?? '',
    }));

    return { events } as unknown as RillValue;
  };
}
