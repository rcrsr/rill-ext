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
// normalizeMessage tests [AC-2, AC-14]
// ============================================================

describe('normalizeMessage', () => {
  describe('full Graph message', () => {
    it('returns exactly 9 fields [AC-2]', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      const keys = Object.keys(result);
      expect(keys).toHaveLength(9);
    });

    it('includes all 9 required field names', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('subject');
      expect(result).toHaveProperty('preview');
      expect(result).toHaveProperty('from');
      expect(result).toHaveProperty('to');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('unread');
      expect(result).toHaveProperty('flagged');
      expect(result).toHaveProperty('has_attachments');
    });

    it('maps id correctly', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.id).toBe('msg-001');
    });

    it('maps subject correctly', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.subject).toBe('Hello World');
    });

    it('maps preview from bodyPreview', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.preview).toBe('This is a preview of the message body.');
    });

    it('maps from address', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.from).toBe('sender@example.com');
    });

    it('maps to as array of addresses', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(Array.isArray(result.to)).toBe(true);
      expect(result.to).toEqual([
        'recipient1@example.com',
        'recipient2@example.com',
      ]);
    });

    it('maps date as epoch ms from receivedDateTime [AC-14]', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(typeof result.date).toBe('number');
      expect(result.date).toBe(EPOCH_2024_03_15_10_30);
    });

    it('maps unread as inverse of isRead', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      // isRead = false → unread = true
      expect(result.unread).toBe(true);
    });

    it('maps flagged when flag.flagStatus is flagged', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.flagged).toBe(true);
    });

    it('maps has_attachments correctly', () => {
      const result = normalizeMessage(FULL_GRAPH_MESSAGE);
      expect(result.has_attachments).toBe(true);
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

  describe('null/absent field defaults [AC-14]', () => {
    it('id defaults to empty string when absent', () => {
      const result = normalizeMessage({});
      expect(result.id).toBe('');
    });

    it('subject defaults to empty string when absent', () => {
      const result = normalizeMessage({});
      expect(result.subject).toBe('');
    });

    it('preview defaults to empty string when absent', () => {
      const result = normalizeMessage({});
      expect(result.preview).toBe('');
    });

    it('from defaults to empty string when absent', () => {
      const result = normalizeMessage({});
      expect(result.from).toBe('');
    });

    it('to defaults to empty array when absent', () => {
      const result = normalizeMessage({});
      expect(result.to).toEqual([]);
    });

    it('date defaults to 0 when receivedDateTime is absent [AC-14]', () => {
      const result = normalizeMessage({});
      expect(result.date).toBe(0);
    });

    it('date defaults to 0 for unparseable date string', () => {
      const result = normalizeMessage({ receivedDateTime: 'not-a-date' });
      expect(result.date).toBe(0);
    });

    it('unread defaults to false when absent', () => {
      const result = normalizeMessage({});
      expect(result.unread).toBe(false);
    });

    it('flagged defaults to false when absent', () => {
      const result = normalizeMessage({});
      expect(result.flagged).toBe(false);
    });

    it('has_attachments defaults to false when absent', () => {
      const result = normalizeMessage({});
      expect(result.has_attachments).toBe(false);
    });

    it('to excludes recipients with missing address', () => {
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
});

// ============================================================
// normalizeEvent tests [AC-14]
// ============================================================

describe('normalizeEvent', () => {
  describe('full Graph event', () => {
    it('returns exactly 8 fields', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      const keys = Object.keys(result);
      expect(keys).toHaveLength(8);
    });

    it('includes all 8 required field names', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('end');
      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('attendees');
      expect(result).toHaveProperty('is_online');
      expect(result).toHaveProperty('online_url');
    });

    it('maps id correctly', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result.id).toBe('evt-001');
    });

    it('maps title from subject', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result.title).toBe('Team Standup');
    });

    it('maps start as epoch ms [AC-14]', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(typeof result.start).toBe('number');
      expect(result.start).toBe(EPOCH_2024_03_15_09_00);
    });

    it('maps end as epoch ms [AC-14]', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(typeof result.end).toBe('number');
      expect(result.end).toBe(EPOCH_2024_03_15_09_30);
    });

    it('maps location from displayName', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result.location).toBe('Conference Room A');
    });

    it('maps attendees as array of addresses', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(Array.isArray(result.attendees)).toBe(true);
      expect(result.attendees).toEqual([
        'alice@example.com',
        'bob@example.com',
      ]);
    });

    it('maps is_online from isOnlineMeeting', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result.is_online).toBe(true);
    });

    it('maps online_url from onlineMeeting.joinUrl', () => {
      const result = normalizeEvent(FULL_GRAPH_EVENT);
      expect(result.online_url).toBe('https://teams.microsoft.com/meet/123');
    });
  });

  describe('null/absent field defaults', () => {
    it('id defaults to empty string', () => {
      expect(normalizeEvent({}).id).toBe('');
    });

    it('title defaults to empty string', () => {
      expect(normalizeEvent({}).title).toBe('');
    });

    it('start defaults to 0 when absent [AC-14]', () => {
      expect(normalizeEvent({}).start).toBe(0);
    });

    it('end defaults to 0 when absent [AC-14]', () => {
      expect(normalizeEvent({}).end).toBe(0);
    });

    it('location defaults to empty string', () => {
      expect(normalizeEvent({}).location).toBe('');
    });

    it('attendees defaults to empty array', () => {
      expect(normalizeEvent({}).attendees).toEqual([]);
    });

    it('is_online defaults to false', () => {
      expect(normalizeEvent({}).is_online).toBe(false);
    });

    it('online_url defaults to empty string', () => {
      expect(normalizeEvent({}).online_url).toBe('');
    });

    it('attendees excludes recipients with missing address', () => {
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
});

// ============================================================
// normalizeScheduleItem tests [AC-14]
// ============================================================

describe('normalizeScheduleItem', () => {
  it('maps all 4 fields', () => {
    const item = {
      status: 'busy',
      subject: 'Meeting',
      start: { dateTime: '2024-03-15T09:00:00Z' },
      end: { dateTime: '2024-03-15T09:30:00Z' },
    };
    const result = normalizeScheduleItem(item);
    expect(result.status).toBe('busy');
    expect(result.subject).toBe('Meeting');
    expect(result.start).toBe(EPOCH_2024_03_15_09_00);
    expect(result.end).toBe(EPOCH_2024_03_15_09_30);
  });

  it('start defaults to 0 when absent [AC-14]', () => {
    const result = normalizeScheduleItem({ status: 'free', subject: 'X' });
    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
  });

  it('status defaults to empty string when absent', () => {
    const result = normalizeScheduleItem({});
    expect(result.status).toBe('');
  });

  it('subject defaults to empty string when absent', () => {
    const result = normalizeScheduleItem({});
    expect(result.subject).toBe('');
  });
});

// ============================================================
// normalizeSchedule tests [AC-14]
// ============================================================

describe('normalizeSchedule', () => {
  describe('full Graph schedule', () => {
    it('maps schedule_id', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.schedule_id).toBe('alice@example.com');
    });

    it('maps availability from availabilityView', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.availability).toBe('free');
    });

    it('maps items array with correct length', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(2);
    });

    it('maps first item status', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[0]!.status).toBe('busy');
    });

    it('maps first item subject', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[0]!.subject).toBe('Team Standup');
    });

    it('maps first item start as epoch ms [AC-14]', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[0]!.start).toBe(EPOCH_2024_03_15_09_00);
    });

    it('maps first item end as epoch ms [AC-14]', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[0]!.end).toBe(EPOCH_2024_03_15_09_30);
    });

    it('maps second item start as epoch ms [AC-14]', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[1]!.start).toBe(EPOCH_2024_03_15_12_00);
    });

    it('maps second item end as epoch ms [AC-14]', () => {
      const result = normalizeSchedule(FULL_GRAPH_SCHEDULE);
      expect(result.items[1]!.end).toBe(EPOCH_2024_03_15_13_00);
    });
  });

  describe('null/absent field defaults', () => {
    it('schedule_id defaults to empty string', () => {
      expect(normalizeSchedule({}).schedule_id).toBe('');
    });

    it('availability defaults to empty string', () => {
      expect(normalizeSchedule({}).availability).toBe('');
    });

    it('items defaults to empty array', () => {
      expect(normalizeSchedule({}).items).toEqual([]);
    });
  });
});
