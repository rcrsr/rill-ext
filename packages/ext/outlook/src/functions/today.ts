/**
 * today host function — list calendar events for the current UTC day.
 */

import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeEvent } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Fetch all calendar events for today's UTC day.
 * Computes start (00:00:00 UTC) and end (23:59:59.999 UTC) internally.
 * Returns dict with `events` list.
 */
export async function today(
  _args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const now = new Date();

  // Compute UTC day boundaries
  const todayStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const todayEnd = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );

  const startIso = todayStart.toISOString();
  const endIso = todayEnd.toISOString();

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

  return { events: eventList } as unknown as RillValue;
}
