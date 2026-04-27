/**
 * events host function — list calendar events within a time range.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeEvent } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch calendar events for a time range using calendarView.
 * Inputs are epoch milliseconds; converted to ISO 8601 for Graph API.
 * Returns dict with `events` list and `range` string.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when start > end
 */
export async function events(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const start = (args['start'] as number) ?? 0;
  const end = (args['end'] as number) ?? 0;

  if (start > end) {
    failInput(ctx, 'invalid_range', 'outlook: start must be before end');
  }

  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();
  const range = `${startIso}/${endIso}`;

  const path = `calendar/calendarView?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}`;

  const response = await graphFetch(
    'GET',
    path,
    config.auth,
    config.mailbox,
    ctx,
    controller
  );

  const data = response as { value?: unknown[] };
  const eventList = (data.value ?? []).map(normalizeEvent);

  return { events: eventList, range } as unknown as RillValue;
}
