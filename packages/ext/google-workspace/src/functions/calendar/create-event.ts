/**
 * calendar_create_event callable — create a calendar event.
 * IR-17: calendar_create_event(title: str, startTime: str, endTime: str, options: dict?) → str
 * Capability: calendar.create
 * Scopes: calendar.events
 */

import { RuntimeError, isDict } from '@rcrsr/rill';
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

const CAL_WRITE_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

/** Valid sendUpdates values per Google Calendar API v3. */
const VALID_SEND_UPDATES = new Set(['all', 'externalOnly', 'none']);

export interface CalendarCreateEventDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
  readonly calendarConfig: CalendarConfig | undefined;
}

/**
 * Factory returning the calendar_create_event inner function.
 * EC-11: Validates calendarId against allowedCalendarIds.
 * EC-12: Rejects all-day events when calendarConfig.denyAllDay is true.
 * EC-13: Rejects naive ISO timestamps (no timezone).
 * AC-12: Returns event ID string.
 */
export function makeCalendarCreateEvent(deps: CalendarCreateEventDeps): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const title = args['title'];
    const startTime = args['startTime'];
    const endTime = args['endTime'];

    if (typeof title !== 'string' || title.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: title must be a non-empty string');
    }
    if (typeof startTime !== 'string' || startTime.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: startTime must be a non-empty string');
    }
    if (typeof endTime !== 'string' || endTime.trim() === '') {
      throw new RuntimeError('RILL-R004', 'google: endTime must be a non-empty string');
    }

    // EC-13: Reject naive ISO timestamps
    assertIsoTimestamp(startTime, 'startTime');
    assertIsoTimestamp(endTime, 'endTime');

    // Extract options
    const options = args['options'];
    let calendarId = 'primary';
    let isAllDay = false;
    let sendUpdates = 'none';
    let attendees: Array<{ email: string }> | undefined;
    let description: string | undefined;

    if (options !== undefined && options !== null && isDict(options)) {
      const rawCalId = options['calendarId'];
      if (typeof rawCalId === 'string' && rawCalId.trim() !== '') {
        calendarId = rawCalId;
      }

      const rawAllDay = options['allDay'];
      if (typeof rawAllDay === 'boolean') {
        isAllDay = rawAllDay;
      }

      const rawSendUpdates = options['sendUpdates'];
      if (typeof rawSendUpdates === 'string' && VALID_SEND_UPDATES.has(rawSendUpdates)) {
        sendUpdates = rawSendUpdates;
      }

      const rawAttendees = options['attendees'];
      if (Array.isArray(rawAttendees)) {
        attendees = rawAttendees
          .filter((a): a is Record<string, RillValue> => typeof a === 'object' && a !== null)
          .map((a) => ({ email: String(a['email'] ?? '') }))
          .filter((a) => a.email !== '');
      }

      const rawDescription = options['description'];
      if (typeof rawDescription === 'string') {
        description = rawDescription;
      }
    }

    // EC-11: Validate calendarId against allowlist
    assertAllowedCalendarId(calendarId, deps.calendarConfig);

    // EC-12: Reject all-day events when denyAllDay is configured
    if (isAllDay && deps.calendarConfig?.denyAllDay === true) {
      throw new RuntimeError('RILL-R004', 'google: all-day events not permitted');
    }

    // Build event body
    type EventBody = {
      summary: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      attendees?: Array<{ email: string }>;
      description?: string;
    };

    const body: EventBody = {
      summary: title,
      start: isAllDay
        ? { date: startTime.slice(0, 10) }
        : { dateTime: startTime },
      end: isAllDay
        ? { date: endTime.slice(0, 10) }
        : { dateTime: endTime },
    };

    if (attendees !== undefined && attendees.length > 0) {
      body.attendees = attendees;
    }
    if (description !== undefined) {
      body.description = description;
    }

    const path =
      `/calendars/${encodeURIComponent(calendarId)}/events` +
      `?sendUpdates=${encodeURIComponent(sendUpdates)}`;

    const response = await googleFetch(
      'POST',
      CAL_BASE,
      path,
      'calendar',
      'create_event',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      CAL_WRITE_SCOPES,
      body,
      undefined,
      undefined
    );

    // Return event ID string [IR-17, AC-12]
    const data = response as { id?: string } | null;
    const eventId = data?.id ?? '';

    return eventId as unknown as RillValue;
  };
}
