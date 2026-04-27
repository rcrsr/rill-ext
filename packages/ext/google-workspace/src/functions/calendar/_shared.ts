/**
 * Shared constants and validators for Calendar callables.
 * Extracted to satisfy §BASIC.2 (no 3+ duplicates).
 */

import { RuntimeError } from '@rcrsr/rill';
import type { CalendarConfig } from '../../types.js';

export const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

const ISO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Assert that a string is ISO 8601 datetime with timezone.
 * Throws RILL-R004 for naive timestamps (no Z or offset).
 * EC-13
 */
export function assertIsoTimestamp(value: string, field: string): void {
  if (!ISO_TZ_RE.test(value)) {
    throw new RuntimeError(
      'RILL-R004',
      `google: ${field} must be ISO 8601 with timezone`
    );
  }
}

/**
 * Validate calendarId against allowedCalendarIds when defined.
 * EC-11
 */
export function assertAllowedCalendarId(
  calendarId: string,
  calendarConfig: CalendarConfig | undefined
): void {
  if (
    calendarConfig?.allowedCalendarIds !== undefined &&
    calendarConfig.allowedCalendarIds.length > 0 &&
    !calendarConfig.allowedCalendarIds.includes(calendarId)
  ) {
    throw new RuntimeError(
      'RILL-R004',
      `google: calendar '${calendarId}' not in allowed set`
    );
  }
}
