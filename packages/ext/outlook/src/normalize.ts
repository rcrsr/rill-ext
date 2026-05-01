/**
 * Response normalizers for Microsoft Graph API data models.
 * Converts raw Graph API objects to rill-compatible dicts with
 * ISO 8601 → epoch ms conversion and spec-defined null defaults.
 */

// ============================================================
// TYPE SHAPES (raw Graph API response shapes)
// ============================================================

interface GraphEmailAddress {
  readonly address?: string | undefined;
}

interface GraphRecipient {
  readonly emailAddress?: GraphEmailAddress | undefined;
}

interface GraphMessage {
  readonly id?: string | undefined;
  readonly subject?: string | undefined;
  readonly bodyPreview?: string | undefined;
  readonly from?: GraphRecipient | undefined;
  readonly toRecipients?: readonly GraphRecipient[] | undefined;
  readonly receivedDateTime?: string | undefined;
  readonly isRead?: boolean | undefined;
  readonly flag?: { readonly flagStatus?: string | undefined } | undefined;
  readonly hasAttachments?: boolean | undefined;
}

interface GraphDateTimeTimeZone {
  readonly dateTime?: string | undefined;
}

interface GraphEvent {
  readonly id?: string | undefined;
  readonly subject?: string | undefined;
  readonly start?: GraphDateTimeTimeZone | undefined;
  readonly end?: GraphDateTimeTimeZone | undefined;
  readonly location?: { readonly displayName?: string | undefined } | undefined;
  readonly attendees?: readonly GraphRecipient[] | undefined;
  readonly isOnlineMeeting?: boolean | undefined;
  readonly onlineMeeting?: { readonly joinUrl?: string | undefined } | undefined;
}

interface GraphScheduleItem {
  readonly status?: string | undefined;
  readonly subject?: string | undefined;
  readonly start?: GraphDateTimeTimeZone | undefined;
  readonly end?: GraphDateTimeTimeZone | undefined;
}

interface GraphSchedule {
  readonly scheduleId?: string | undefined;
  readonly availabilityView?: string | undefined;
  readonly scheduleItems?: readonly GraphScheduleItem[] | undefined;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert an ISO 8601 date string to epoch milliseconds.
 * Returns 0 when value is absent or unparseable.
 */
function isoToEpochMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// ============================================================
// MAIL MESSAGE
// ============================================================

/**
 * MailMessageDict - 9 fields from Graph API message.
 * AC-14: date is epoch ms converted from ISO 8601.
 */
export interface MailMessageDict {
  readonly id: string;
  readonly subject: string;
  readonly preview: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly date: number;
  readonly unread: boolean;
  readonly flagged: boolean;
  readonly has_attachments: boolean;
}

/**
 * Normalize a raw Graph API message object to MailMessageDict.
 * All nullable fields use spec defaults: empty string, empty list, false, or 0.
 *
 * @param graphMsg - Raw Graph API message response object
 * @returns MailMessageDict with all 9 fields
 */
export function normalizeMessage(graphMsg: unknown): MailMessageDict {
  const msg = graphMsg as GraphMessage;

  const to =
    msg.toRecipients
      ?.map((r) => r.emailAddress?.address ?? '')
      .filter((a) => a !== '') ?? [];

  return {
    id: msg.id ?? '',
    subject: msg.subject ?? '',
    preview: msg.bodyPreview ?? '',
    from: msg.from?.emailAddress?.address ?? '',
    to,
    date: isoToEpochMs(msg.receivedDateTime),
    unread: msg.isRead !== undefined ? !msg.isRead : false,
    flagged: msg.flag?.flagStatus === 'flagged',
    has_attachments: msg.hasAttachments ?? false,
  };
}

// ============================================================
// CALENDAR EVENT
// ============================================================

/**
 * CalendarEventDict - 8 fields from Graph API event.
 * AC-14: start and end are epoch ms converted from ISO 8601.
 * Uses onlineMeeting.joinUrl, not deprecated onlineMeetingUrl.
 */
export interface CalendarEventDict {
  readonly id: string;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly location: string;
  readonly attendees: readonly string[];
  readonly is_online: boolean;
  readonly online_url: string;
}

/**
 * Normalize a raw Graph API event object to CalendarEventDict.
 * All nullable fields use spec defaults: empty string, empty list, false, or 0.
 *
 * @param graphEvent - Raw Graph API event response object
 * @returns CalendarEventDict with all 8 fields
 */
export function normalizeEvent(graphEvent: unknown): CalendarEventDict {
  const ev = graphEvent as GraphEvent;

  const attendees =
    ev.attendees
      ?.map((r) => r.emailAddress?.address ?? '')
      .filter((a) => a !== '') ?? [];

  return {
    id: ev.id ?? '',
    title: ev.subject ?? '',
    start: isoToEpochMs(ev.start?.dateTime),
    end: isoToEpochMs(ev.end?.dateTime),
    location: ev.location?.displayName ?? '',
    attendees,
    is_online: ev.isOnlineMeeting ?? false,
    online_url: ev.onlineMeeting?.joinUrl ?? '',
  };
}

// ============================================================
// FREE/BUSY SCHEDULE
// ============================================================

/**
 * ScheduleItemDict - one slot within a FreeBusyScheduleDict.
 * AC-14: start and end are epoch ms converted from ISO 8601.
 */
export interface ScheduleItemDict {
  readonly status: string;
  readonly subject: string;
  readonly start: number;
  readonly end: number;
}

/**
 * FreeBusyScheduleDict - one attendee's schedule.
 * items is a list of ScheduleItemDict objects.
 */
export interface FreeBusyScheduleDict {
  readonly schedule_id: string;
  readonly availability: string;
  readonly items: readonly ScheduleItemDict[];
}

/**
 * Normalize a raw Graph API scheduleItem to ScheduleItemDict.
 *
 * @param item - Raw Graph API scheduleItem object
 * @returns ScheduleItemDict with status, subject, start, end
 */
export function normalizeScheduleItem(item: unknown): ScheduleItemDict {
  const si = item as GraphScheduleItem;
  return {
    status: si.status ?? '',
    subject: si.subject ?? '',
    start: isoToEpochMs(si.start?.dateTime),
    end: isoToEpochMs(si.end?.dateTime),
  };
}

/**
 * Normalize a raw Graph API schedule object to FreeBusyScheduleDict.
 * All nullable fields use spec defaults: empty string, empty list.
 *
 * @param graphSchedule - Raw Graph API schedule response object
 * @returns FreeBusyScheduleDict with scheduleId, availability, items
 */
export function normalizeSchedule(graphSchedule: unknown): FreeBusyScheduleDict {
  const sch = graphSchedule as GraphSchedule;

  const items = sch.scheduleItems?.map(normalizeScheduleItem) ?? [];

  return {
    schedule_id: sch.scheduleId ?? '',
    availability: sch.availabilityView ?? '',
    items,
  };
}
