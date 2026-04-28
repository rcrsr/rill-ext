/**
 * Tests for tz:: namespace functions: iso, date, time, offset, zones.
 */

import { describe, it, expect } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

function getExt() {
  return createDatetimeExtension({}, makeFactoryCtx());
}

function getIso(ext: ReturnType<typeof getExt>) {
  return ext.value.iso.fn;
}

function getDate(ext: ReturnType<typeof getExt>) {
  return ext.value.date.fn;
}

function getTime(ext: ReturnType<typeof getExt>) {
  return ext.value.time.fn;
}

function getOffset(ext: ReturnType<typeof getExt>) {
  return ext.value.offset.fn;
}

function getZones(ext: ReturnType<typeof getExt>) {
  return ext.value.zones.fn;
}

// ============================================================
// UTC EPOCH CONSTANTS
// ============================================================

const DT_EST = Date.parse('2026-03-08T06:00:00Z');
const DT_DST_TRANSITION = Date.parse('2026-03-08T07:00:00Z');
const DT_DST_BEFORE = Date.parse('2026-03-08T06:59:59Z');
const DT_2026_04_01_23 = Date.parse('2026-04-01T23:00:00Z');
const DT_EPOCH = 0;
const DT_NY_SUMMER = Date.parse('2026-07-01T12:00:00Z');
const DT_NY_WINTER = Date.parse('2026-01-15T12:00:00Z');
const DT_2026_JAN = Date.parse('2026-01-01T00:00:00Z');

// ============================================================
// tz::iso
// ============================================================

describe('tz::iso', () => {
  it('AC-1: converts UTC 06:00Z to America/New_York EST 01:00:00-05:00', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_EST, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe('2026-03-08T01:00:00-05:00');
  });

  it('AC-B1: DST transition instant 2026-03-08T07:00:00Z resolves to EDT -04:00', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_DST_TRANSITION, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe('2026-03-08T03:00:00-04:00');
  });

  it('AC-B1: one second before spring-forward resolves to EST -05:00', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_DST_BEFORE, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe('2026-03-08T01:59:59-05:00');
  });

  it('AC-B2: epoch datetime in Africa/Abidjan produces 1970-01-01T00:00:00+00:00', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_EPOCH, zone: 'Africa/Abidjan' }, makeRuntimeCtx());
    expect(result).toBe('1970-01-01T00:00:00+00:00');
  });

  it('AC-E1: unknown zone "Fake/Zone" returns invalid value', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_EST, zone: 'Fake/Zone' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/Fake\/Zone/);
  });

  it('AC-E5: string dt argument returns invalid value', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: '2026-03-08T06:00:00Z', zone: 'America/New_York' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected datetime/);
  });

  it('AC-E5: object dt argument returns invalid value', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: { value: 0 }, zone: 'America/New_York' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected datetime/);
  });

  it('EC-6: number zone argument returns invalid value', async () => {
    const ext = getExt();
    const result = await getIso(ext)({ dt: DT_EPOCH, zone: 9 }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected string/);
  });
});

// ============================================================
// tz::date
// ============================================================

describe('tz::date', () => {
  it('AC-2: UTC 2026-04-01T23:00:00Z + Asia/Tokyo crosses midnight to 2026-04-02', async () => {
    const ext = getExt();
    const result = await getDate(ext)({ dt: DT_2026_04_01_23, zone: 'Asia/Tokyo' }, makeRuntimeCtx());
    expect(result).toBe('2026-04-02');
  });

  it('AC-B2: epoch datetime in Africa/Abidjan returns 1970-01-01', async () => {
    const ext = getExt();
    const result = await getDate(ext)({ dt: DT_EPOCH, zone: 'Africa/Abidjan' }, makeRuntimeCtx());
    expect(result).toBe('1970-01-01');
  });

  it('AC-E5: string dt argument returns invalid value', async () => {
    const ext = getExt();
    const result = await getDate(ext)({ dt: '2026-04-01', zone: 'Asia/Tokyo' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected datetime/);
  });

  it('EC-1: unknown zone returns invalid value with zone in message', async () => {
    const ext = getExt();
    const result = await getDate(ext)({ dt: DT_EPOCH, zone: 'Fake/Zone' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/Fake\/Zone/);
  });
});

// ============================================================
// tz::time
// ============================================================

describe('tz::time', () => {
  it('AC-3: produces correct HH:mm:ss for America/New_York EST', async () => {
    const ext = getExt();
    const result = await getTime(ext)({ dt: DT_EST, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe('01:00:00');
  });

  it('AC-3: UTC 2026-04-01T23:00:00Z + Asia/Tokyo produces 08:00:00', async () => {
    const ext = getExt();
    const result = await getTime(ext)({ dt: DT_2026_04_01_23, zone: 'Asia/Tokyo' }, makeRuntimeCtx());
    expect(result).toBe('08:00:00');
  });

  it('AC-B2: epoch datetime in Africa/Abidjan returns 00:00:00', async () => {
    const ext = getExt();
    const result = await getTime(ext)({ dt: DT_EPOCH, zone: 'Africa/Abidjan' }, makeRuntimeCtx());
    expect(result).toBe('00:00:00');
  });

  it('AC-E5: string dt argument returns invalid value', async () => {
    const ext = getExt();
    const result = await getTime(ext)({ dt: 'noon', zone: 'Asia/Tokyo' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected datetime/);
  });
});

// ============================================================
// tz::offset
// ============================================================

describe('tz::offset', () => {
  it('AC-4: Asia/Calcutta without dt returns typeof number', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ zone: 'Asia/Calcutta' }, makeRuntimeCtx());
    expect(typeof result).toBe('number');
  });

  it('AC-5: America/New_York with summer datetime returns -4', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ dt: DT_NY_SUMMER, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe(-4);
  });

  it('AC-5: America/New_York with winter datetime returns -5', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ dt: DT_NY_WINTER, zone: 'America/New_York' }, makeRuntimeCtx());
    expect(result).toBe(-5);
  });

  it('AC-B5: Asia/Calcutta returns 5.5', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ dt: DT_2026_JAN, zone: 'Asia/Calcutta' }, makeRuntimeCtx());
    expect(result).toBe(5.5);
  });

  it('AC-B6: Asia/Katmandu returns 5.75 for a 2026 instant', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ dt: DT_2026_JAN, zone: 'Asia/Katmandu' }, makeRuntimeCtx());
    expect(result).toBe(5.75);
  });

  it('EC-1: unknown zone returns invalid value with zone in message', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ zone: 'Fake/Zone' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/Fake\/Zone/);
  });

  it('EC-6: non-string zone returns invalid value', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ zone: 42 }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected string/);
  });

  it('AC-E5: non-datetime dt with valid zone returns invalid value', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ zone: 'America/New_York', dt: 'yesterday' }, makeRuntimeCtx());
    const status = getStatus(result);
    expect(status.code.name).toBe('INVALID_INPUT');
    expect(status.message).toMatch(/expected datetime/);
  });
});

// ============================================================
// tz::zones
// ============================================================

describe('tz::zones', () => {
  it('AC-6: returns non-empty array', async () => {
    const ext = getExt();
    const result = await getZones(ext)({}, makeRuntimeCtx());
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThan(0);
  });

  it('AC-6: every element in result is a string', async () => {
    const ext = getExt();
    const result = (await getZones(ext)({}, makeRuntimeCtx())) as unknown[];
    for (const z of result) {
      expect(typeof z).toBe('string');
    }
  });

  it('AC-6: includes America/New_York and Asia/Tokyo', async () => {
    const ext = getExt();
    const allZones = (await getZones(ext)({}, makeRuntimeCtx())) as string[];
    expect(allZones).toContain('America/New_York');
    expect(allZones).toContain('Asia/Tokyo');
  });

  it('AC-6: sample zones from zones() are accepted by tz::iso without error', async () => {
    const ext = getExt();
    const allZones = (await getZones(ext)({}, makeRuntimeCtx())) as string[];

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
      await expect(isoFn({ dt: DT_2026_JAN, zone }, makeRuntimeCtx())).resolves.toBeTypeOf('string');
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
    const result = await getIso(ext)({ dt, zone }, makeRuntimeCtx());
    expect(typeof result).toBe('string');
  });

  it('tz::date returns typeof string', async () => {
    const ext = getExt();
    const result = await getDate(ext)({ dt, zone }, makeRuntimeCtx());
    expect(typeof result).toBe('string');
  });

  it('tz::time returns typeof string', async () => {
    const ext = getExt();
    const result = await getTime(ext)({ dt, zone }, makeRuntimeCtx());
    expect(typeof result).toBe('string');
  });

  it('tz::offset returns typeof number', async () => {
    const ext = getExt();
    const result = await getOffset(ext)({ dt, zone }, makeRuntimeCtx());
    expect(typeof result).toBe('number');
  });

  it('tz::zones returns an array with string elements', async () => {
    const ext = getExt();
    const result = await getZones(ext)({}, makeRuntimeCtx());
    expect(Array.isArray(result)).toBe(true);
    const arr = result as unknown[];
    expect(arr.length).toBeGreaterThan(0);
    for (const z of arr) {
      expect(typeof z).toBe('string');
    }
  });
});
