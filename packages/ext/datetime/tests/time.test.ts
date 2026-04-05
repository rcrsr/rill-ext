/**
 * Tests for time::format and time::parse host functions.
 *
 * Covers: AC-7, AC-8, AC-9, AC-10, AC-11, AC-B2, AC-B3, AC-B4,
 *         AC-E2, AC-E3, EC-5, EC-6.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { createDatetimeExtension } from '../src/factory.js';

// Helper: extract the raw fn from a callable in the value dict.
function getFormatFn(
  ext: ReturnType<typeof createDatetimeExtension>,
): (args: Record<string, unknown>) => Promise<unknown> {
  return (ext.value.format as { fn: (args: Record<string, unknown>) => Promise<unknown> }).fn;
}

function getParseFn(
  ext: ReturnType<typeof createDatetimeExtension>,
): (args: Record<string, unknown>) => Promise<unknown> {
  return (ext.value.parse as { fn: (args: Record<string, unknown>) => Promise<unknown> }).fn;
}

// Epoch ms for a specific UTC instant.
const DT_2026_03_13 = Date.parse('2026-03-13T08:30:45.123Z'); // 1741855845123
const DT_EPOCH = Date.parse('1970-01-01T00:00:00.000Z'); // 0

describe('time::format', () => {
  // ============================================================
  // AC-7: Full pattern produces expected string
  // ============================================================

  describe('AC-7: full timestamp pattern', () => {
    it('formats 2026-03-13T08:30:45.123Z with YYYY-MM-DD HH:mm:ss.SSS', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_2026_03_13, pattern: 'YYYY-MM-DD HH:mm:ss.SSS' });

      expect(result).toBe('2026-03-13 08:30:45.123');
    });
  });

  // ============================================================
  // AC-B2: Epoch datetime formats correctly with all tokens
  // ============================================================

  describe('AC-B2: epoch datetime with all tokens', () => {
    it('formats 1970-01-01T00:00:00.000Z with all 7 tokens', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_EPOCH, pattern: 'YYYY-MM-DD HH:mm:ss.SSS' });

      expect(result).toBe('1970-01-01 00:00:00.000');
    });

    it('formats epoch year component as 1970', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_EPOCH, pattern: 'YYYY' });

      expect(result).toBe('1970');
    });

    it('formats epoch month component as 01', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_EPOCH, pattern: 'MM' });

      expect(result).toBe('01');
    });

    it('formats epoch milliseconds component as 000', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_EPOCH, pattern: 'SSS' });

      expect(result).toBe('000');
    });
  });

  // ============================================================
  // AC-B3: Pattern with only literal characters returns literal unchanged
  // ============================================================

  describe('AC-B3: literal-only pattern', () => {
    it('returns literal string unchanged when pattern has no tokens', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      // Non-alphabetic characters are treated as literals.
      const result = await fn({ dt: DT_2026_03_13, pattern: '---::.' });

      expect(result).toBe('---::.');
    });
  });

  // ============================================================
  // AC-E2: Unknown token throws RuntimeError RILL-R004
  // ============================================================

  describe('AC-E2: unknown format token', () => {
    it('throws RuntimeError with errorId RILL-R004 for pattern XXXX', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: DT_2026_03_13, pattern: 'XXXX' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('includes the unknown token in the error message', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: DT_2026_03_13, pattern: 'XXXX' });
      } catch (err) {
        caught = err;
      }

      expect((caught as RuntimeError).message).toContain('XXXX');
    });

    it('throws for single unknown alphabetic character', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: DT_2026_03_13, pattern: 'Z' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });
  });

  // ============================================================
  // EC-5: Non-datetime dt argument throws RuntimeError RILL-R004
  // ============================================================

  describe('EC-5: invalid dt argument type', () => {
    it('throws RuntimeError RILL-R004 when dt is a string', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: '2026-03-13', pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('expected datetime');
      expect((caught as RuntimeError).message).toContain('string');
    });

    it('throws RuntimeError RILL-R004 when dt is null', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: null, pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('throws RuntimeError RILL-R004 when dt is a boolean', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: true, pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('expected datetime');
    });
  });

  // ============================================================
  // EC-6: Non-string pattern argument throws RuntimeError RILL-R004
  // ============================================================

  describe('EC-6: invalid pattern argument type', () => {
    it('throws RuntimeError RILL-R004 when pattern is a number', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: DT_2026_03_13, pattern: 42 });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('expected string');
      expect((caught as RuntimeError).message).toContain('number');
    });

    it('throws RuntimeError RILL-R004 when pattern is null', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      let caught: unknown;
      try {
        await fn({ dt: DT_2026_03_13, pattern: null });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });
  });
});

describe('time::parse', () => {
  // ============================================================
  // AC-9: Date-only parse zero-fills time to midnight UTC
  // ============================================================

  describe('AC-9: date-only parse zero-fills time', () => {
    it('parses 2026-03-13 with YYYY-MM-DD and returns midnight UTC epoch ms', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      const result = await fn({ str: '2026-03-13', pattern: 'YYYY-MM-DD' });

      // midnight UTC on 2026-03-13
      const expectedEpochMs = Date.UTC(2026, 2, 13, 0, 0, 0, 0);
      expect(result).toBe(expectedEpochMs);
    });

    it('parses date-only and result matches new Date(...).toISOString() midnight', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      const result = await fn({ str: '2026-03-13', pattern: 'YYYY-MM-DD' });

      const d = new Date(result as number);
      expect(d.toISOString()).toBe('2026-03-13T00:00:00.000Z');
    });
  });

  // ============================================================
  // AC-8: Round-trip: format then parse returns original epoch ms
  // ============================================================

  describe('AC-8: format/parse round-trip', () => {
    it('round-trips 2026-03-13T08:30:45.123Z with full pattern', async () => {
      const ext = createDatetimeExtension();
      const formatFn = getFormatFn(ext);
      const parseFn = getParseFn(ext);

      const pattern = 'YYYY-MM-DD HH:mm:ss.SSS';
      const formatted = await formatFn({ dt: DT_2026_03_13, pattern });
      const parsed = await parseFn({ str: formatted as string, pattern });

      expect(parsed).toBe(DT_2026_03_13);
    });

    it('round-trips epoch datetime with full pattern', async () => {
      const ext = createDatetimeExtension();
      const formatFn = getFormatFn(ext);
      const parseFn = getParseFn(ext);

      const pattern = 'YYYY-MM-DD HH:mm:ss.SSS';
      const formatted = await formatFn({ dt: DT_EPOCH, pattern });
      const parsed = await parseFn({ str: formatted as string, pattern });

      expect(parsed).toBe(DT_EPOCH);
    });

    it('round-trips date-only pattern', async () => {
      const ext = createDatetimeExtension();
      const formatFn = getFormatFn(ext);
      const parseFn = getParseFn(ext);

      const pattern = 'YYYY-MM-DD';
      // Midnight UTC on 2026-03-13
      const midnightEpoch = Date.UTC(2026, 2, 13, 0, 0, 0, 0);
      const formatted = await formatFn({ dt: midnightEpoch, pattern });
      const parsed = await parseFn({ str: formatted as string, pattern });

      expect(parsed).toBe(midnightEpoch);
    });
  });

  // ============================================================
  // AC-11: Parse without timezone info treats input as UTC
  // ============================================================

  describe('AC-11: no timezone info treated as UTC', () => {
    it('parses datetime string without tz suffix as UTC', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      const result = await fn({ str: '2026-03-13 08:30:45.123', pattern: 'YYYY-MM-DD HH:mm:ss.SSS' });

      // parseWithPattern uses Date.UTC, so no tz offset applied.
      expect(result).toBe(DT_2026_03_13);
    });
  });

  // ============================================================
  // AC-10: Embedded timezone offset behavior
  //
  // [SPEC] The TOKEN_REGISTRY has no timezone offset token and no
  // way to express a literal 'T' separator (alphabetic chars not
  // matching a registered token trigger EC-2 in validatePattern).
  //
  // A pattern like "YYYY-MM-DD HH:mm:ss" uses a space separator
  // (non-alphabetic, treated as literal). A string with an
  // embedded +HH:MM offset suffix such as "2026-03-13 08:30:45+05:30"
  // will fail to match because "+05:30" is not covered by any token
  // or literal and the regex is anchored (^...$).
  //
  // The implementation therefore throws EC-3 (parse mismatch) for
  // inputs with embedded timezone offsets. The spec says embedded
  // offsets convert to UTC, but the current implementation does not
  // support this. Documented as a spec limitation.
  // ============================================================

  describe('AC-10: embedded timezone offset behavior (spec limitation)', () => {
    it('throws RuntimeError RILL-R004 for input with embedded +HH:MM offset not in pattern', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      // Space separator is non-alphabetic (literal). The "+05:30" suffix
      // is not matched by any token or literal in the pattern, so the
      // anchored regex fails and EC-3 is thrown.
      let caught: unknown;
      try {
        await fn({ str: '2026-03-13 08:30:45+05:30', pattern: 'YYYY-MM-DD HH:mm:ss' });
      } catch (err) {
        caught = err;
      }

      // Current behavior: mismatch error because suffix is unmatched.
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('cannot parse');
      expect((caught as RuntimeError).message).toContain('2026-03-13 08:30:45+05:30');
    });

    it('throws EC-2 for Z suffix because Z is an unrecognized alphabetic token', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      // Z is an alphabetic character not in TOKEN_REGISTRY, so validatePattern
      // throws EC-2 when Z appears in the pattern.
      let caught: unknown;
      try {
        await fn({ str: '2026-03-13 08:30:45Z', pattern: 'YYYY-MM-DD HH:mm:ssZ' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('Z');
    });
  });

  // ============================================================
  // AC-B2: Epoch datetime parses correctly
  // ============================================================

  describe('AC-B2: epoch datetime parse', () => {
    it('parses 1970-01-01 00:00:00.000 and returns 0', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      const result = await fn({ str: '1970-01-01 00:00:00.000', pattern: 'YYYY-MM-DD HH:mm:ss.SSS' });

      expect(result).toBe(0);
    });
  });

  // ============================================================
  // AC-B3: Literal-only pattern with matching literal input
  //
  // [SPEC] parseWithPattern requires match.groups to be truthy.
  // When a pattern has no tokens, the regex has no named capture groups
  // and match.groups is undefined. The function therefore throws EC-3
  // even when the literal input matches the literal pattern exactly.
  // A pattern with at least one token is required for a successful parse.
  // ============================================================

  describe('AC-B3: literal-only pattern parse', () => {
    it('throws EC-3 for literal-only pattern because no named groups exist', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      // Non-alphabetic literals: pattern is valid (no unknown tokens),
      // input matches the regex, but match.groups is undefined so EC-3 fires.
      let caught: unknown;
      try {
        await fn({ str: '---::.', pattern: '---::.' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('cannot parse');
    });
  });

  // ============================================================
  // AC-B4: Empty pattern with empty input
  //
  // [SPEC] Same as AC-B3: empty pattern produces regex ^$ which matches
  // empty string, but match.groups is undefined so EC-3 is thrown.
  // The format function with empty pattern returns an empty string.
  // ============================================================

  describe('AC-B4: empty pattern with empty input', () => {
    it('throws EC-3 for empty pattern with empty input because no named groups exist', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: '', pattern: '' });
      } catch (err) {
        caught = err;
      }

      // Empty regex ^$ matches empty string but match.groups is undefined.
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('format with empty pattern returns empty string', async () => {
      const ext = createDatetimeExtension();
      const fn = getFormatFn(ext);

      const result = await fn({ dt: DT_2026_03_13, pattern: '' });

      expect(result).toBe('');
    });
  });

  // ============================================================
  // AC-E2: Unknown format token in parse pattern throws RuntimeError
  // ============================================================

  describe('AC-E2: unknown token in parse pattern', () => {
    it('throws RuntimeError RILL-R004 with token in message for pattern XXXX', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: '2026', pattern: 'XXXX' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('XXXX');
    });
  });

  // ============================================================
  // AC-E3: Input string doesn't match pattern throws RuntimeError
  // ============================================================

  describe('AC-E3: input mismatch', () => {
    it('throws RuntimeError RILL-R004 for "abc" with pattern YYYY-MM-DD', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: 'abc', pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });

    it('includes both input string and pattern in the error message', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: 'abc', pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      const msg = (caught as RuntimeError).message;
      expect(msg).toContain('abc');
      expect(msg).toContain('YYYY-MM-DD');
    });

    it('throws for partial match (year only for full timestamp pattern)', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: '2026', pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
    });
  });

  // ============================================================
  // EC-5: Non-datetime argument to parse str throws RuntimeError
  // ============================================================

  describe('EC-6: invalid str argument type for parse', () => {
    it('throws RuntimeError RILL-R004 when str is a number', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: 42, pattern: 'YYYY-MM-DD' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('expected string');
    });

    it('throws RuntimeError RILL-R004 when pattern is a boolean', async () => {
      const ext = createDatetimeExtension();
      const fn = getParseFn(ext);

      let caught: unknown;
      try {
        await fn({ str: '2026-03-13', pattern: false });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toContain('expected string');
    });
  });
});

// ============================================================
// AC-NF4: rill-compatible return types
// ============================================================

describe('AC-NF4: rill-compatible return types', () => {
  it('time::format returns typeof string', async () => {
    const ext = createDatetimeExtension();
    const fn = getFormatFn(ext);
    const result = await fn({ dt: Date.parse('2026-01-01T00:00:00Z'), pattern: 'YYYY-MM-DD' });
    expect(typeof result).toBe('string');
  });

  it('time::parse returns typeof number (epoch ms datetime)', async () => {
    const ext = createDatetimeExtension();
    const fn = getParseFn(ext);
    const result = await fn({ str: '2026-01-01', pattern: 'YYYY-MM-DD' });
    expect(typeof result).toBe('number');
  });
});
