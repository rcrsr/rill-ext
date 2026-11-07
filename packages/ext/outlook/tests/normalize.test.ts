/**
 * Normalize function tests for Outlook extension.
 * Verifies MailMessageDict (9 fields), CalendarEventDict (8 fields),
 * FreeBusyScheduleDict, epoch ms conversions, and null/absent field defaults.
 * Covers: AC-2, AC-14.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeMessage,
  normalizeEvent,
  normalizeSchedule,
  normalizeScheduleItem,
} from '../src/normalize.js';

// ============================================================
// FIXTURES
// ============================================================

/** Full Graph API message with all fields populated. */
const FULL_GRAPH_MESSAGE = {
  id: 'msg-001',
  subject: 'Hello World',
  bodyPreview: 'This is a preview of the message body.',
  from: { emailAddress: { address: 'sender@example.com' } },
  toRecipients: [
    { emailAddress: { address: 'recipient1@example.com' } },
    { emailAddress: { address: 'recipient2@example.com' } },
  ],
  receivedDateTime: '2024-03-15T10:30:00Z',
  isRead: false,
  flag: { flagStatus: 'flagged' },
  hasAttachments: true,
};

/** Full Graph API event with all fields populated. */
const FULL_GRAPH_EVENT = {
  id: 'evt-001',
  subject: 'Team Standup',
  start: { dateTime: '2024-03-15T09:00:00Z' },
  end: { dateTime: '2024-03-15T09:30:00Z' },
  location: { displayName: 'Conference Room A' },
  attendees: [
    { emailAddress: { address: 'alice@example.com' } },
    { emailAddress: { address: 'bob@example.com' } },
  ],
  isOnlineMeeting: true,
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/meet/123' },
};

/** Full Graph API schedule with items. */
const FULL_GRAPH_SCHEDULE = {
  scheduleId: 'alice@example.com',
  availabilityView: 'free',
  scheduleItems: [
    {
      status: 'busy',
      subject: 'Team Standup',
      start: { dateTime: '2024-03-15T09:00:00Z' },
      end: { dateTime: '2024-03-15T09:30:00Z' },
    },
    {
      status: 'tentative',
      subject: 'Lunch',
      start: { dateTime: '2024-03-15T12:00:00Z' },
      end: { dateTime: '2024-03-15T13:00:00Z' },
    },
  ],
};

// Compute expected epoch ms values for known ISO strings
const EPOCH_2024_03_15_10_30 = Date.parse('2024-03-15T10:30:00Z');
const EPOCH_2024_03_15_09_00 = Date.parse('2024-03-15T09:00:00Z');
const EPOCH_2024_03_15_09_30 = Date.parse('2024-03-15T09:30:00Z');
const EPOCH_2024_03_15_12_00 = Date.parse('2024-03-15T12:00:00Z');
const EPOCH_2024_03_15_13_00 = Date.parse('2024-03-15T13:00:00Z');

// ============================================================
// normalizeMessage tests
// ============================================================

describe('normalizeMessage', () => {
  it('maps a full Graph message to the exact 9-field dict', () => {
    expect(normalizeMessage(FULL_GRAPH_MESSAGE)).toEqual({
      id: 'msg-001',
      subject: 'Hello World',
      preview: 'This is a preview of the message body.',
      from: 'sender@example.com',
      to: ['recipient1@example.com', 'recipient2@example.com'],
      date: EPOCH_2024_03_15_10_30,
      unread: true,
      flagged: true,
      has_attachments: true,
    });
  });

  it('defaults every field when the Graph message is empty', () => {
    expect(normalizeMessage({})).toEqual({
      id: '',
      subject: '',
      preview: '',
      from: '',
      to: [],
      date: 0,
      unread: false,
      flagged: false,
      has_attachments: false,
    });
  });

  describe('isRead mapping', () => {
    it('unread is false when isRead is true', () => {
      const msg = { ...FULL_GRAPH_MESSAGE, isRead: true };
      const result = normalizeMessage(msg);
      expect(result.unread).toBe(false);
    });

    it('unread is false when isRead is absent', () => {
      const { isRead: _omit, ...msgWithout } = FULL_GRAPH_MESSAGE;
      const result = normalizeMessage(msgWithout);
      expect(result.unread).toBe(false);
    });
  });

  describe('flagged mapping', () => {
    it('flagged is false when flag.flagStatus is notFlagged', () => {
      const msg = { ...FULL_GRAPH_MESSAGE, flag: { flagStatus: 'notFlagged' } };
      const result = normalizeMessage(msg);
      expect(result.flagged).toBe(false);
    });

    it('flagged is false when flag is absent', () => {
      const { flag: _omit, ...msgWithout } = FULL_GRAPH_MESSAGE;
      const result = normalizeMessage(msgWithout);
      expect(result.flagged).toBe(false);
    });
  });

  it('defaults date to 0 for unparseable date string', () => {
    const result = normalizeMessage({ receivedDateTime: 'not-a-date' });
    expect(result.date).toBe(0);
  });

  it('excludes recipients with missing or empty address from to', () => {
    const msg = {
      toRecipients: [
        { emailAddress: { address: 'good@example.com' } },
        { emailAddress: {} }, // no address
        { emailAddress: { address: '' } }, // empty address
      ],
    };
    const result = normalizeMessage(msg);
    expect(result.to).toEqual(['good@example.com']);
  });
});

// ============================================================
// normalizeEvent tests
// ============================================================

describe('normalizeEvent', () => {
  it('maps a full Graph event to the exact 8-field dict', () => {
    expect(normalizeEvent(FULL_GRAPH_EVENT)).toEqual({
      id: 'evt-001',
      title: 'Team Standup',
      start: EPOCH_2024_03_15_09_00,
      end: EPOCH_2024_03_15_09_30,
      location: 'Conference Room A',
      attendees: ['alice@example.com', 'bob@example.com'],
      is_online: true,
      online_url: 'https://teams.microsoft.com/meet/123',
    });
  });

  it('defaults every field when the Graph event is empty', () => {
    expect(normalizeEvent({})).toEqual({
      id: '',
      title: '',
      start: 0,
      end: 0,
      location: '',
      attendees: [],
      is_online: false,
      online_url: '',
    });
  });

  it('excludes attendees with missing address', () => {
    const ev = {
      attendees: [
        { emailAddress: { address: 'a@example.com' } },
        { emailAddress: {} },
      ],
    };
    const result = normalizeEvent(ev);
    expect(result.attendees).toEqual(['a@example.com']);
  });
});

// ============================================================
// normalizeScheduleItem tests
// ============================================================

describe('normalizeScheduleItem', () => {
  it('maps a full Graph schedule item to the exact 4-field dict', () => {
    const item = {
      status: 'busy',
      subject: 'Meeting',
      start: { dateTime: '2024-03-15T09:00:00Z' },
      end: { dateTime: '2024-03-15T09:30:00Z' },
    };
    expect(normalizeScheduleItem(item)).toEqual({
      status: 'busy',
      subject: 'Meeting',
      start: EPOCH_2024_03_15_09_00,
      end: EPOCH_2024_03_15_09_30,
    });
  });

  it('defaults start and end to 0 when absent', () => {
    expect(normalizeScheduleItem({ status: 'free', subject: 'X' })).toEqual({
      status: 'free',
      subject: 'X',
      start: 0,
      end: 0,
    });
  });

  it('defaults every field when the Graph item is empty', () => {
    expect(normalizeScheduleItem({})).toEqual({
      status: '',
      subject: '',
      start: 0,
      end: 0,
    });
  });
});

// ============================================================
// normalizeSchedule tests
// ============================================================

describe('normalizeSchedule', () => {
  it('maps a full Graph schedule including both items', () => {
    expect(normalizeSchedule(FULL_GRAPH_SCHEDULE)).toEqual({
      schedule_id: 'alice@example.com',
      availability: 'free',
      items: [
        {
          status: 'busy',
          subject: 'Team Standup',
          start: EPOCH_2024_03_15_09_00,
          end: EPOCH_2024_03_15_09_30,
        },
        {
          status: 'tentative',
          subject: 'Lunch',
          start: EPOCH_2024_03_15_12_00,
          end: EPOCH_2024_03_15_13_00,
        },
      ],
    });
  });

  it('defaults every field when the Graph schedule is empty', () => {
    expect(normalizeSchedule({})).toEqual({
      schedule_id: '',
      availability: '',
      items: [],
    });
  });
});
