/**
 * freeBusy host function — query free/busy schedules for attendees.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeSchedule } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch free/busy schedule data for a list of attendees.
 * Uses POST /me/calendar/getSchedule. Inputs are epoch milliseconds.
 * Returns dict with `schedules` list and `range` string.
 *
 * @throws RuntimeError (RILL-R004) when start > end or attendees is empty
 */
export async function freeBusy(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const start = (args['start'] as number) ?? 0;
  const end = (args['end'] as number) ?? 0;

  if (start > end) {
    throw new RuntimeError('RILL-R004', 'outlook: start must be before end');
  }

  const rawAttendees = args['attendees'];
  const attendees: string[] = Array.isArray(rawAttendees)
    ? (rawAttendees as RillValue[]).map((v) => String(v))
    : [];

  if (attendees.length === 0) {
    throw new RuntimeError('RILL-R004', 'outlook: attendees is required');
  }

  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const range = `${startIso}/${endIso}`;

  const requestBody = {
    schedules: attendees,
    startTime: { dateTime: startIso, timeZone: 'UTC' },
    endTime: { dateTime: endIso, timeZone: 'UTC' },
  };

  const response = await graphFetch(
    'POST',
    'calendar/getSchedule',
    config.auth,
    config.mailbox,
    ctx,
    controller,
    requestBody
  );

  const data = response as { value?: unknown[] };
  const schedules = (data.value ?? []).map(normalizeSchedule);

  return { schedules, range } as unknown as RillValue;
}
