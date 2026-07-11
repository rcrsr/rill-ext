/**
 * createEvent host function — create a calendar event via Graph API.
 * Requires calendar.create capability. Graph returns HTTP 201 with event body.
 */

import { failInput } from '../errors.js';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
import { graphFetch } from '../graph.js';
import { normalizeEvent } from '../normalize.js';
import type { ResolvedConfig } from '../factory.js';

/**
 * Create a calendar event using POST /me/calendar/events.
 * Epoch ms inputs convert to ISO 8601 for Graph API.
 * Returns a CalendarEventDict from the 201 response body.
 *
 * @throws an invalid RillValue (#INVALID_INPUT) when title is empty or start > end
 */
export async function createEvent(
  args: Record<string, RillValue>,
  ctx: RuntimeContext,
  controller: AbortController,
  config: ResolvedConfig
): Promise<RillValue> {
  const title = (args['title'] as string | undefined) ?? '';
  if (title.trim() === '') {
    failInput(ctx, 'missing_title', 'outlook: title is required');
  }

  const start = (args['start'] as number) ?? 0;
  const end = (args['end'] as number) ?? 0;

  if (start > end) {
    failInput(ctx, 'invalid_range', 'outlook: start must be before end');
  }

  const startIso = new Date(start).toISOString();
  const endIso = new Date(end).toISOString();

  // Build base event body
  const eventBody: Record<string, unknown> = {
    subject: title,
    start: { dateTime: startIso, timeZone: 'UTC' },
    end: { dateTime: endIso, timeZone: 'UTC' },
  };

  // Apply optional fields from options dict
  const options = args['options'] as Record<string, RillValue> | undefined;
  if (
    options !== null &&
    options !== undefined &&
    typeof options === 'object'
  ) {
    if (Array.isArray(options['attendees'])) {
      eventBody['attendees'] = (options['attendees'] as RillValue[]).map(
        (addr) => ({
          emailAddress: { address: String(addr) },
          type: 'required',
        })
      );
    }

    if (typeof options['location'] === 'string' && options['location'] !== '') {
      eventBody['location'] = { displayName: options['location'] };
    }

    if (typeof options['isOnline'] === 'boolean') {
      eventBody['isOnlineMeeting'] = options['isOnline'];
    }
  }

  const response = await graphFetch(
    'POST',
    'calendar/events',
    config.auth,
    config.mailbox,
    ctx,
    controller,
    eventBody
  );

  return normalizeEvent(response) as unknown as RillValue;
}
