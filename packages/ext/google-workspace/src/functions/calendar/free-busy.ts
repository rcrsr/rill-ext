/**
 * calendar_free_busy callable — query free/busy information for a set of calendars.
 * IR-18: calendar_free_busy(emails: list[str], startTime: str, endTime: str) → dict
 * Capability: calendar.freeBusy
 * Scopes: calendar.readonly
 */
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { failInput } from '../../errors.js';
import { googleFetch } from '../../fetch.js';
import type { GoogleAuth } from '../../types.js';
import type { TokenCache } from '../../auth/resolve.js';
import { CAL_BASE, assertIsoTimestamp } from './_shared.js';
const CAL_FREEBUSY_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
];
export interface CalendarFreeBusyDeps {
  readonly auth: GoogleAuth;
  readonly cache: TokenCache;
}
/**
 * Factory returning the calendar_free_busy inner function.
 * BC-4: Empty emails list → halts with invalid `#INVALID_INPUT` before fetch.
 * EC-13: Rejects naive ISO timestamps (no timezone).
 * AC-12: Returns rill primitive dict keyed by email.
 */
export function makeCalendarFreeBusy(
  deps: CalendarFreeBusyDeps
): (
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController
) => Promise<RillValue> {
  return async (
    args: Record<string, RillValue>,
    ctx: RuntimeContext,
    controller: AbortController
  ): Promise<RillValue> => {
    const emails = args['emails'];
    const startTime = args['start_time'];
    const endTime = args['end_time'];
    // BC-4: Validate emails before fetch
    if (!Array.isArray(emails) || emails.length === 0) {
      failInput(
        ctx,
        'invalid_arg',
        'google: calendar.free_busy: emails must be non-empty'
      );
    }
    // Extract string emails from the list
    const emailStrings = emails.filter(
      (e): e is string => typeof e === 'string' && e.trim() !== ''
    );
    if (emailStrings.length === 0) {
      failInput(
        ctx,
        'invalid_arg',
        'google: calendar.free_busy: emails must be non-empty'
      );
    }
    if (typeof startTime !== 'string' || startTime.trim() === '') {
      failInput(
        ctx,
        'invalid_arg',
        'google: start_time must be a non-empty string'
      );
    }
    if (typeof endTime !== 'string' || endTime.trim() === '') {
      failInput(
        ctx,
        'invalid_arg',
        'google: end_time must be a non-empty string'
      );
    }
    // EC-13: Reject naive ISO timestamps
    assertIsoTimestamp(ctx, startTime, 'start_time');
    assertIsoTimestamp(ctx, endTime, 'end_time');
    const body = {
      timeMin: startTime,
      timeMax: endTime,
      items: emailStrings.map((email) => ({ id: email })),
    };
    const response = await googleFetch(
      'POST',
      CAL_BASE,
      '/freeBusy',
      'calendar',
      'free_busy',
      deps.auth,
      ctx,
      controller,
      deps.cache,
      CAL_FREEBUSY_SCOPES,
      body,
      undefined,
      undefined
    );
    // Project to { <email>: { busy: [{ start, end }, ...] }, ... } [AC-12]
    const data = response as {
      calendars?: Record<
        string,
        {
          busy?: Array<{ start?: string; end?: string }>;
        }
      >;
    } | null;
    const calendars = data?.calendars ?? {};
    const result: Record<
      string,
      { busy: Array<{ start: string; end: string }> }
    > = {};
    for (const email of emailStrings) {
      const calData = calendars[email];
      const busySlots = (calData?.busy ?? []).map((slot) => ({
        start: slot.start ?? '',
        end: slot.end ?? '',
      }));
      result[email] = { busy: busySlots };
    }
    return result as unknown as RillValue;
  };
}
