/**
 * Tests for tz:: namespace functions: iso, date, time, offset, zones.
 *
 * Covers AC-1 through AC-6, AC-E1, AC-E5, AC-B1, AC-B2, AC-B5, AC-B6, EC-6.
 *
 * Environment notes:
 * - "UTC" is not in Intl.supportedValuesOf('timeZone') on this Node runtime.
 *   Use Africa/Abidjan (UTC+0, no DST) as a zero-offset zone.
 * - Asia/Kolkata is not available; use Asia/Calcutta (same zone, UTC+5:30).
 * - Asia/Kathmandu is not available; use Asia/Katmandu (same zone, UTC+5:45).
 *   Asia/Katmandu returns 5.75 for post-1986 dates; use a 2026 instant.
 * - 2026-03-08T07:00:00Z is the exact spring-forward instant for America/New_York
 *   (EDT -4 from that point). AC-1 spec intent (EST, UTC-5) uses 2026-03-08T06:00:00Z
 *   which maps to 01:00:00-05:00.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';

// ============================================================
// INVOCATION HELPERS
// ============================================================

function getExt() {
  return createDatetimeExtension();
}

function getIso(ext: ReturnType<typeof getExt>) {
  return ext.value.iso as { fn: (args: Record<string, unknown>) => Promise<unknown> };
}

function getDate(ext: ReturnType<typeof getExt>) {
  return ext.value.date as { fn: (args: Record<string, unknown>) => Promise<unknown> };
}

function getTime(ext: ReturnType<typeof getExt>) {
  return ext.value.time as { fn: (args: Record<string, unknown>) => Promise<unknown> };
}

function getOffset(ext: ReturnType<typeof getExt>) {
  return ext.value.offset as { fn: (args: Record<string, unknown>) => Promise<unknown> };
}

function getZones(ext: ReturnType<typeof getExt>) {
  return ext.value.zones as { fn: (args: Record<string, unknown>) => Promise<unknown> };
}

// ============================================================
// UTC EPOCH CONSTANTS
// ============================================================

// AC-1 intent: EST (UTC-5). Spring-forward is at 2026-03-08T07:00:00Z exactly.
// Use 2026-03-08T06:00:00Z (clearly EST) -> local 01:00:00-05:00.
const DT_EST = Date.parse('2026-03-08T06:00:00Z');

// Exact DST transition instant: 2026-03-08T07:00:00Z is the FIRST EDT instant (-4).
const DT_DST_TRANSITION = Date.parse('2026-03-08T07:00:00Z');

// One second before spring-forward: still EST (-5).
const DT_DST_BEFORE = Date.parse('2026-03-08T06:59:59Z');

// AC-2: Tokyo midnight crossing
const DT_2026_04_01_23 = Date.parse('2026-04-01T23:00:00Z');

// AC-B2: epoch
const DT_EPOCH = 0;

// AC-5: summer/winter New York
const DT_NY_SUMMER = Date.parse('2026-07-01T12:00:00Z'); // EDT = UTC-4
const DT_NY_WINTER = Date.parse('2026-01-15T12:00:00Z'); // EST = UTC-5

// AC-B5/B6: use a 2026 date so historical offset transitions do not affect results
const DT_2026_JAN = Date.parse('2026-01-01T00:00:00Z');

// ============================================================
// tz::iso
// ============================================================

describe('tz::iso', () => {
  // AC-1: EST behavior - 2026-03-08T06:00:00Z + America/New_York (EST, UTC-5) → 01:00:00-05:00
  it('AC-1: converts UTC 06:00Z to America/New_York EST 01:00:00-05:00', async () => {
    const ext = getExt();
    const result = await getIso(ext).fn({ dt: DT_EST, zone: 'America/New_York' });
    expect(result).toBe('2026-03-08T01:00:00-05:00');
  });

  // AC-B1: exact DST transition instant - 2026-03-08T07:00:00Z is the first EDT instant (-4)
  it('AC-B1: DST transition instant 2026-03-08T07:00:00Z resolves to EDT -04:00', async () => {
    const ext = getExt();
    const result = await getIso(ext).fn({ dt: DT_DST_TRANSITION, zone: 'America/New_York' });
    expect(result).toBe('2026-03-08T03:00:00-04:00');
  });

  // AC-B1 supplement: one second before spring-forward is still EST (-5)
  it('AC-B1: one second before spring-forward resolves to EST -05:00', async () => {
    const ext = getExt();
    const result = await getIso(ext).fn({ dt: DT_DST_BEFORE, zone: 'America/New_York' });
    expect(result).toBe('2026-03-08T01:59:59-05:00');
  });

  // AC-B2: epoch datetime in a zero-offset zone (Africa/Abidjan, UTC+0)
  it('AC-B2: epoch datetime in Africa/Abidjan produces 1970-01-01T00:00:00+00:00', async () => {
    const ext = getExt();
    const result = await getIso(ext).fn({ dt: DT_EPOCH, zone: 'Africa/Abidjan' });
    expect(result).toBe('1970-01-01T00:00:00+00:00');
  });

  // EC-1: Unknown zone → RuntimeError RILL-R004, message contains zone name
  it('AC-E1: unknown zone "Fake/Zone" throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getIso(ext).fn({ dt: DT_EST, zone: 'Fake/Zone' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('Fake/Zone');
  });

  // AC-E5: Non-datetime string as dt → RuntimeError RILL-R004
  it('AC-E5: string dt argument throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getIso(ext).fn({ dt: '2026-03-08T06:00:00Z', zone: 'America/New_York' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected datetime');
  });

  // AC-E5: Object (non-number) as dt → RuntimeError RILL-R004
  it('AC-E5: object dt argument throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getIso(ext).fn({ dt: { value: 0 }, zone: 'America/New_York' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected datetime');
  });

  // EC-6: Non-string zone → RuntimeError RILL-R004
  it('EC-6: number zone argument throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getIso(ext).fn({ dt: DT_EPOCH, zone: 9 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected string');
  });
});

// ============================================================
// tz::date
// ============================================================

describe('tz::date', () => {
  // AC-2: UTC 2026-04-01T23:00:00Z + Asia/Tokyo (UTC+9) crosses midnight → 2026-04-02
  it('AC-2: UTC 2026-04-01T23:00:00Z + Asia/Tokyo crosses midnight to 2026-04-02', async () => {
    const ext = getExt();
    const result = await getDate(ext).fn({ dt: DT_2026_04_01_23, zone: 'Asia/Tokyo' });
    expect(result).toBe('2026-04-02');
  });

  // AC-B2: epoch in zero-offset zone
  it('AC-B2: epoch datetime in Africa/Abidjan returns 1970-01-01', async () => {
    const ext = getExt();
    const result = await getDate(ext).fn({ dt: DT_EPOCH, zone: 'Africa/Abidjan' });
    expect(result).toBe('1970-01-01');
  });

  // AC-E5: Non-datetime string as dt → RuntimeError
  it('AC-E5: string dt argument throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getDate(ext).fn({ dt: '2026-04-01', zone: 'Asia/Tokyo' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected datetime');
  });

  // EC-1: Unknown zone
  it('EC-1: unknown zone throws RuntimeError RILL-R004 with zone in message', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getDate(ext).fn({ dt: DT_EPOCH, zone: 'Fake/Zone' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('Fake/Zone');
  });
});

// ============================================================
// tz::time
// ============================================================

describe('tz::time', () => {
  // AC-3: UTC 2026-03-08T06:00:00Z + America/New_York (EST, UTC-5) → 01:00:00
  it('AC-3: produces correct HH:mm:ss for America/New_York EST', async () => {
    const ext = getExt();
    const result = await getTime(ext).fn({ dt: DT_EST, zone: 'America/New_York' });
    expect(result).toBe('01:00:00');
  });

  // AC-3: UTC 2026-04-01T23:00:00Z + Asia/Tokyo (UTC+9) → 08:00:00
  it('AC-3: UTC 2026-04-01T23:00:00Z + Asia/Tokyo produces 08:00:00', async () => {
    const ext = getExt();
    const result = await getTime(ext).fn({ dt: DT_2026_04_01_23, zone: 'Asia/Tokyo' });
    expect(result).toBe('08:00:00');
  });

  // AC-B2: epoch in zero-offset zone
  it('AC-B2: epoch datetime in Africa/Abidjan returns 00:00:00', async () => {
    const ext = getExt();
    const result = await getTime(ext).fn({ dt: DT_EPOCH, zone: 'Africa/Abidjan' });
    expect(result).toBe('00:00:00');
  });

  // AC-E5: Non-datetime string as dt → RuntimeError
  it('AC-E5: string dt argument throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getTime(ext).fn({ dt: 'noon', zone: 'Asia/Tokyo' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected datetime');
  });
});

// ============================================================
// tz::offset
// ============================================================

describe('tz::offset', () => {
  // AC-4: Asia/Calcutta without dt → returns current offset as a number
  // (Asia/Calcutta is the available alias for Asia/Kolkata, UTC+5:30)
  it('AC-4: Asia/Calcutta without dt returns typeof number', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ zone: 'Asia/Calcutta' });
    expect(typeof result).toBe('number');
  });

  // AC-5: America/New_York summer → -4 (EDT)
  it('AC-5: America/New_York with summer datetime returns -4', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ dt: DT_NY_SUMMER, zone: 'America/New_York' });
    expect(result).toBe(-4);
  });

  // AC-5: America/New_York winter → -5 (EST)
  it('AC-5: America/New_York with winter datetime returns -5', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ dt: DT_NY_WINTER, zone: 'America/New_York' });
    expect(result).toBe(-5);
  });

  // AC-B5: Asia/Calcutta (Kolkata alias) → 5.5 (30-minute fractional offset)
  it('AC-B5: Asia/Calcutta returns 5.5', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ dt: DT_2026_JAN, zone: 'Asia/Calcutta' });
    expect(result).toBe(5.5);
  });

  // AC-B6: Asia/Katmandu (Kathmandu alias) → 5.75 (45-minute offset, post-1986)
  it('AC-B6: Asia/Katmandu returns 5.75 for a 2026 instant', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ dt: DT_2026_JAN, zone: 'Asia/Katmandu' });
    expect(result).toBe(5.75);
  });

  // EC-1: Unknown zone → RuntimeError
  it('EC-1: unknown zone throws RuntimeError RILL-R004 with zone in message', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getOffset(ext).fn({ zone: 'Fake/Zone' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('Fake/Zone');
  });

  // EC-6: Non-string zone → RuntimeError RILL-R004
  it('EC-6: non-string zone throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getOffset(ext).fn({ zone: 42 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected string');
  });

  // AC-E5: Non-datetime dt when zone is valid → RuntimeError RILL-R004
  // Note: zone is validated before dt, so use a valid zone with an invalid dt.
  it('AC-E5: non-datetime dt with valid zone throws RuntimeError RILL-R004', async () => {
    const ext = getExt();
    let caught: unknown;
    try {
      await getOffset(ext).fn({ zone: 'America/New_York', dt: 'yesterday' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    expect((caught as RuntimeError).message).toContain('expected datetime');
  });
});

// ============================================================
// tz::zones
// ============================================================

describe('tz::zones', () => {
  // AC-6: returns non-empty array
  it('AC-6: returns non-empty array', async () => {
    const ext = getExt();
    const result = await getZones(ext).fn({});
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThan(0);
  });

  // AC-6: every element is a string
  it('AC-6: every element in result is a string', async () => {
    const ext = getExt();
    const result = (await getZones(ext).fn({})) as unknown[];
    for (const z of result) {
      expect(typeof z).toBe('string');
    }
  });

  // AC-6: includes known valid zones
  it('AC-6: includes America/New_York and Asia/Tokyo', async () => {
    const ext = getExt();
    const allZones = (await getZones(ext).fn({})) as string[];
    expect(allZones).toContain('America/New_York');
    expect(allZones).toContain('Asia/Tokyo');
  });

  // AC-6: sample 5 zones accepted by tz::iso without error
  it('AC-6: sample zones from zones() are accepted by tz::iso without error', async () => {
    const ext = getExt();
    const allZones = (await getZones(ext).fn({})) as string[];

    // Pick 5 spread across the array: first, last, and 3 evenly spaced
    const count = allZones.length;
    const indices = [
      0,
      Math.floor(count * 0.25),
      Math.floor(count * 0.5),
      Math.floor(count * 0.75),
      count - 1,
    ];

    const isoFn = getIso(ext);
    for (const i of indices) {
      const zone = allZones[i]!;
      await expect(
        isoFn.fn({ dt: DT_2026_JAN, zone }),
      ).resolves.toBeTypeOf('string');
    }
  });
});

// ============================================================
// AC-NF4: rill-compatible return types
// ============================================================

describe('AC-NF4: rill-compatible return types', () => {
  const dt = Date.parse('2026-01-01T00:00:00Z');
  const zone = 'America/New_York';

  it('tz::iso returns typeof string', async () => {
    const ext = getExt();
    const result = await getIso(ext).fn({ dt, zone });
    expect(typeof result).toBe('string');
  });

  it('tz::date returns typeof string', async () => {
    const ext = getExt();
    const result = await getDate(ext).fn({ dt, zone });
    expect(typeof result).toBe('string');
  });

  it('tz::time returns typeof string', async () => {
    const ext = getExt();
    const result = await getTime(ext).fn({ dt, zone });
    expect(typeof result).toBe('string');
  });

  it('tz::offset returns typeof number', async () => {
    const ext = getExt();
    const result = await getOffset(ext).fn({ dt, zone });
    expect(typeof result).toBe('number');
  });

  it('tz::zones returns an array with string elements', async () => {
    const ext = getExt();
    const result = await getZones(ext).fn({});
    expect(Array.isArray(result)).toBe(true);
    const arr = result as unknown[];
    expect(arr.length).toBeGreaterThan(0);
    for (const z of arr) {
      expect(typeof z).toBe('string');
    }
  });
});
