/**
 * Tests for time::format and time::parse host functions.
 *
 * Covers: AC-7, AC-8, AC-9, AC-10, AC-11, AC-B2, AC-B3, AC-B4,
 *         AC-E2, AC-E3, EC-5, EC-6.
 */

import { describe, it, expect } from 'vitest';
import { getStatus } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

function mk() {
  return createDatetimeExtension({}, makeFactoryCtx());
}

function getFormatFn(ext: ReturnType<typeof mk>) {
  return ext.value.format.fn;
}

function getParseFn(ext: ReturnType<typeof mk>) {
  return ext.value.parse.fn;
}

// Epoch ms for a specific UTC instant.
const DT_2026_03_13 = Date.parse('2026-03-13T08:30:45.123Z'); // 1741855845123
const DT_EPOCH = Date.parse('1970-01-01T00:00:00.000Z'); // 0

describe('time::format', () => {
  describe('AC-7: full timestamp pattern', () => {
    it('formats 2026-03-13T08:30:45.123Z with YYYY-MM-DD HH:mm:ss.SSS', async () => {
      const ext = mk();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_2026_03_13, pattern: 'YYYY-MM-DD HH:mm:ss.SSS' }, makeRuntimeCtx());

      expect(result).toBe('2026-03-13 08:30:45.123');
    });
  });

  describe('AC-B2: epoch datetime with all tokens', () => {
    it('formats 1970-01-01T00:00:00.000Z with all 7 tokens', async () => {
      const ext = mk();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_EPOCH, pattern: 'YYYY-MM-DD HH:mm:ss.SSS' }, makeRuntimeCtx());

      expect(result).toBe('1970-01-01 00:00:00.000');
    });

    it('formats epoch year component as 1970', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_EPOCH, pattern: 'YYYY' }, makeRuntimeCtx());
      expect(result).toBe('1970');
    });

    it('formats epoch month component as 01', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_EPOCH, pattern: 'MM' }, makeRuntimeCtx());
      expect(result).toBe('01');
    });

    it('formats epoch milliseconds component as 000', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_EPOCH, pattern: 'SSS' }, makeRuntimeCtx());
      expect(result).toBe('000');
    });
  });

  describe('AC-B3: literal-only pattern', () => {
    it('returns literal string unchanged when pattern has no tokens', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: '---::.' }, makeRuntimeCtx());
      expect(result).toBe('---::.');
    });
  });

  describe('AC-E2: unknown format token', () => {
    it('returns invalid value with R001 for pattern XXXX', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: 'XXXX' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });

    it('includes the unknown token in the error message', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: 'XXXX' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.message).toMatch(/XXXX/);
    });

    it('returns invalid for single unknown alphabetic character', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: 'Z' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });
  });

  describe('EC-5: invalid dt argument type', () => {
    it('returns invalid value when dt is a string', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: '2026-03-13', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expected datetime/);
      expect(status.message).toMatch(/string/);
    });

    it('returns invalid value when dt is null', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: null, pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });

    it('returns invalid value when dt is a boolean', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: true, pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expected datetime/);
    });
  });

  describe('EC-6: invalid pattern argument type', () => {
    it('returns invalid value when pattern is a number', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: 42 }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expected string/);
      expect(status.message).toMatch(/number/);
    });

    it('returns invalid value when pattern is null', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: null }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });
  });
});

describe('time::parse', () => {
  describe('AC-9: date-only parse zero-fills time', () => {
    it('parses 2026-03-13 with YYYY-MM-DD and returns midnight UTC epoch ms', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '2026-03-13', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());

      const expectedEpochMs = Date.UTC(2026, 2, 13, 0, 0, 0, 0);
      expect(result).toBe(expectedEpochMs);
    });

    it('parses date-only and result matches new Date(...).toISOString() midnight', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '2026-03-13', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());

      const d = new Date(result as number);
      expect(d.toISOString()).toBe('2026-03-13T00:00:00.000Z');
    });
  });

  describe('AC-8: format/parse round-trip', () => {
    it('round-trips 2026-03-13T08:30:45.123Z with full pattern', async () => {
      const ext = mk();
      const pattern = 'YYYY-MM-DD HH:mm:ss.SSS';
      const formatted = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern }, makeRuntimeCtx());
      const parsed = await getParseFn(ext)({ str: formatted as string, pattern }, makeRuntimeCtx());

      expect(parsed).toBe(DT_2026_03_13);
    });

    it('round-trips epoch datetime with full pattern', async () => {
      const ext = mk();
      const pattern = 'YYYY-MM-DD HH:mm:ss.SSS';
      const formatted = await getFormatFn(ext)({ dt: DT_EPOCH, pattern }, makeRuntimeCtx());
      const parsed = await getParseFn(ext)({ str: formatted as string, pattern }, makeRuntimeCtx());

      expect(parsed).toBe(DT_EPOCH);
    });

    it('round-trips date-only pattern', async () => {
      const ext = mk();
      const pattern = 'YYYY-MM-DD';
      const midnightEpoch = Date.UTC(2026, 2, 13, 0, 0, 0, 0);
      const formatted = await getFormatFn(ext)({ dt: midnightEpoch, pattern }, makeRuntimeCtx());
      const parsed = await getParseFn(ext)({ str: formatted as string, pattern }, makeRuntimeCtx());

      expect(parsed).toBe(midnightEpoch);
    });
  });

  describe('AC-11: no timezone info treated as UTC', () => {
    it('parses datetime string without tz suffix as UTC', async () => {
      const ext = mk();
      const result = await getParseFn(ext)(
        { str: '2026-03-13 08:30:45.123', pattern: 'YYYY-MM-DD HH:mm:ss.SSS' },
        makeRuntimeCtx(),
      );
      expect(result).toBe(DT_2026_03_13);
    });
  });

  describe('AC-10: embedded timezone offset behavior (spec limitation)', () => {
    it('returns invalid for input with embedded +HH:MM offset not in pattern', async () => {
      const ext = mk();
      const result = await getParseFn(ext)(
        { str: '2026-03-13 08:30:45+05:30', pattern: 'YYYY-MM-DD HH:mm:ss' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/cannot parse/);
      expect(status.message).toMatch(/2026-03-13 08:30:45\+05:30/);
    });

    it('returns invalid for Z suffix because Z is an unrecognized alphabetic token', async () => {
      const ext = mk();
      const result = await getParseFn(ext)(
        { str: '2026-03-13 08:30:45Z', pattern: 'YYYY-MM-DD HH:mm:ssZ' },
        makeRuntimeCtx(),
      );
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/Z/);
    });
  });

  describe('AC-B2: epoch datetime parse', () => {
    it('parses 1970-01-01 00:00:00.000 and returns 0', async () => {
      const ext = mk();
      const result = await getParseFn(ext)(
        { str: '1970-01-01 00:00:00.000', pattern: 'YYYY-MM-DD HH:mm:ss.SSS' },
        makeRuntimeCtx(),
      );
      expect(result).toBe(0);
    });
  });

  describe('AC-B3: literal-only pattern parse', () => {
    it('returns invalid for literal-only pattern because no named groups exist', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '---::.', pattern: '---::.' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/cannot parse/);
    });
  });

  describe('AC-B4: empty pattern with empty input', () => {
    it('returns invalid for empty pattern with empty input because no named groups exist', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '', pattern: '' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });

    it('format with empty pattern returns empty string', async () => {
      const ext = mk();
      const result = await getFormatFn(ext)({ dt: DT_2026_03_13, pattern: '' }, makeRuntimeCtx());
      expect(result).toBe('');
    });
  });

  describe('AC-E2: unknown token in parse pattern', () => {
    it('returns invalid with token in message for pattern XXXX', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '2026', pattern: 'XXXX' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/XXXX/);
    });
  });

  describe('AC-E3: input mismatch', () => {
    it('returns invalid for "abc" with pattern YYYY-MM-DD', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: 'abc', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });

    it('includes both input string and pattern in the error message', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: 'abc', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.message).toMatch(/abc/);
      expect(status.message).toMatch(/YYYY-MM-DD/);
    });

    it('returns invalid for partial match (year only for full timestamp pattern)', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '2026', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
    });
  });

  describe('EC-6: invalid str argument type for parse', () => {
    it('returns invalid when str is a number', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: 42, pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expected string/);
    });

    it('returns invalid when pattern is a boolean', async () => {
      const ext = mk();
      const result = await getParseFn(ext)({ str: '2026-03-13', pattern: false }, makeRuntimeCtx());
      const status = getStatus(result);
      expect(status.code.name).toBe('INVALID_INPUT');
      expect(status.message).toMatch(/expected string/);
    });
  });
});

describe('AC-NF4: rill-compatible return types', () => {
  it('time::format returns typeof string', async () => {
    const ext = mk();
    const result = await getFormatFn(ext)(
      { dt: Date.parse('2026-01-01T00:00:00Z'), pattern: 'YYYY-MM-DD' },
      makeRuntimeCtx(),
    );
    expect(typeof result).toBe('string');
  });

  it('time::parse returns typeof number (epoch ms datetime)', async () => {
    const ext = mk();
    const result = await getParseFn(ext)({ str: '2026-01-01', pattern: 'YYYY-MM-DD' }, makeRuntimeCtx());
    expect(typeof result).toBe('number');
  });
});
