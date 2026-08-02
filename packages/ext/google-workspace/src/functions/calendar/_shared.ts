/**
 * Shared constants and validators for Calendar callables.
 * Extracted to satisfy §BASIC.2 (no 3+ duplicates).
 *
 * Validators throw invalid `RillValue`s via `ctx.invalidate`; the wrap()'s
 * catch passes them through unchanged.
 */

import type { RuntimeContext } from '@rcrsr/rill';
import type { CalendarConfig } from '../../types.js';
import { failInput, failForbidden } from '../../errors.js';

export const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

const ISO_TZ_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Assert that a string is ISO 8601 datetime with timezone.
 * Throws an invalid RillValue (`#INVALID_INPUT`) for naive timestamps.
 */
export function assertIsoTimestamp(
  ctx: RuntimeContext,
  value: string,
  field: string
): void {
  if (!ISO_TZ_RE.test(value)) {
    failInput(
      ctx,
      'naive_iso_timestamp',
      `google: ${field} must be ISO 8601 with timezone`
    );
  }
}

/**
 * Validate calendarId against allowedCalendarIds when defined.
 * Throws an invalid RillValue (`#FORBIDDEN`) when calendarId is not allowed.
 */
export function assertAllowedCalendarId(
  ctx: RuntimeContext,
  calendarId: string,
  calendarConfig: CalendarConfig | undefined
): void {
  if (
    calendarConfig?.allowedCalendarIds !== undefined &&
    calendarConfig.allowedCalendarIds.length > 0 &&
    !calendarConfig.allowedCalendarIds.includes(calendarId)
  ) {
    failForbidden(
      ctx,
      'calendar_not_allowed',
      `google: calendar '${calendarId}' not in allowed set`
    );
  }
}
