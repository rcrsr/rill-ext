/**
 * Tests for validateExtraKeys, validateMaxTurns, and RESERVED_KEYS_COMMON
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import {
  RESERVED_KEYS_COMMON,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
} from '../src/extra.js';
import type { LLMProviderConfig } from '../src/types.js';

function expectConfigError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(RuntimeError);
  expect((thrown as RuntimeError).errorId).toBe('RILL-R001');
  expect((thrown as RuntimeError).message).toContain(message);
}

const POSITIVE_INTEGER_MESSAGE = 'must be a positive integer or undefined.';

// ============================================================
// validateExtraKeys
// ============================================================

describe('validateExtraKeys', () => {
  describe('undefined extra', () => {
    it('returns without throwing when extra is undefined', () => {
      expect(() =>
        validateExtraKeys(undefined, RESERVED_KEYS_COMMON)
      ).not.toThrow();
    });
  });

  describe('EC-20: non-plain-object extra', () => {
    it.each([
      { label: 'null', value: null },
      { label: 'an array', value: [] },
      { label: 'a string', value: 'string' },
      { label: 'a number', value: 42 },
    ])('throws RILL-R001 with "must be a dict" for $label', ({ value }) => {
      expectConfigError(
        () => validateExtraKeys(value, RESERVED_KEYS_COMMON),
        "Factory config 'extra' must be a dict."
      );
    });
  });

  describe('EC-19: reserved key collision', () => {
    it.each([
      { key: 'model', extra: { model: 'x' } },
      { key: 'temperature', extra: { temperature: 0.5 } },
    ])(
      "throws RILL-R001 listing '$key' when extra contains it",
      ({ key, extra }) => {
        expectConfigError(
          () => validateExtraKeys(extra, RESERVED_KEYS_COMMON),
          `reserved key(s): '${key}'.`
        );
      }
    );

    it('throws RILL-R001 listing colliding keys in sorted order', () => {
      expectConfigError(
        () =>
          validateExtraKeys(
            { stream: true, model: 'x', foo: 1 },
            RESERVED_KEYS_COMMON
          ),
        "reserved key(s): 'model', 'stream'."
      );
    });
  });

  describe('non-reserved keys', () => {
    it("returns without throwing for key 'reasoning_effort' which is not reserved", () => {
      expect(() =>
        validateExtraKeys({ reasoning_effort: 'high' }, RESERVED_KEYS_COMMON)
      ).not.toThrow();
    });

    it('returns without throwing for an empty extra object', () => {
      expect(() => validateExtraKeys({}, RESERVED_KEYS_COMMON)).not.toThrow();
    });
  });
});

// ============================================================
// validateMaxTurns
// ============================================================

describe('validateMaxTurns', () => {
  describe('undefined value', () => {
    it('returns without throwing for undefined (IR-8)', () => {
      expect(() => validateMaxTurns(undefined)).not.toThrow();
    });
  });

  describe('valid positive integers', () => {
    it.each([{ value: 5 }, { value: 1 }])(
      'returns without throwing for $value',
      ({ value }) => {
        expect(() => validateMaxTurns(value)).not.toThrow();
      }
    );
  });

  describe('EC-21: sentinel value 0', () => {
    it('throws RILL-R001 with sentinel-reserved message for 0', () => {
      expectConfigError(
        () => validateMaxTurns(0),
        "Factory config 'max_turns' must be a positive integer or undefined; sentinel value 0 is reserved for per-call override semantics."
      );
    });
  });

  describe('EC-22: negative or non-integer', () => {
    it.each([{ value: -1 }, { value: 2.5 }, { value: -0.5 }])(
      'throws RILL-R001 with positive-integer message for $value',
      ({ value }) => {
        expectConfigError(
          () => validateMaxTurns(value),
          `Factory config 'max_turns' ${POSITIVE_INTEGER_MESSAGE}`
        );
      }
    );
  });
});

// ============================================================
// validateMaxErrors
// ============================================================

describe('validateMaxErrors', () => {
  it('returns without throwing for undefined', () => {
    expect(() => validateMaxErrors(undefined)).not.toThrow();
  });

  it('returns without throwing for a positive integer', () => {
    expect(() => validateMaxErrors(5)).not.toThrow();
    expect(() => validateMaxErrors(1)).not.toThrow();
  });

  it.each([
    { label: '0', value: 0 },
    { label: 'a negative integer', value: -1 },
    { label: 'a non-integer number', value: 2.5 },
    { label: 'a non-number value', value: '3' },
  ])('throws RILL-R001 for $label', ({ value }) => {
    expectConfigError(() => validateMaxErrors(value), POSITIVE_INTEGER_MESSAGE);
  });
});

// ============================================================
// LLMProviderConfig typecheck (IR-8)
// ============================================================

describe('LLMProviderConfig type compatibility', () => {
  it('accepts a config with max_turns, max_errors, and extra fields', () => {
    // Compile-time assertion: tsc rejects the file if these fields are removed or retyped.
    expectTypeOf<{
      api_key: string;
      model: string;
      max_turns: number;
      max_errors: number;
      extra: Record<string, number>;
    }>().toExtend<LLMProviderConfig>();
    expectTypeOf<LLMProviderConfig['max_turns']>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<LLMProviderConfig['max_errors']>().toEqualTypeOf<
      number | undefined
    >();
  });
});
