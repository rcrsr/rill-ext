/**
 * Tests for validateExtraKeys, validateMaxTurns, and RESERVED_KEYS_COMMON
 */

import { describe, expect, it } from 'vitest';
import {
  RESERVED_KEYS_COMMON,
  validateExtraKeys,
  validateMaxTurns,
  validateMaxErrors,
} from '../src/extra.js';
import type { LLMProviderConfig } from '../src/types.js';

// ============================================================
// RESERVED_KEYS_COMMON
// ============================================================

describe('RESERVED_KEYS_COMMON', () => {
  it('contains exactly the 7 specified keys in order', () => {
    expect(RESERVED_KEYS_COMMON).toEqual([
      'messages',
      'model',
      'system',
      'temperature',
      'max_tokens',
      'stream',
      'response_format',
    ]);
  });
});

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
    it('throws RILL-R001 with "must be a dict" for null', () => {
      expect(() => validateExtraKeys(null, RESERVED_KEYS_COMMON)).toThrow(
        /must be a dict/
      );
    });

    it('throws RILL-R001 with "must be a dict" for an array', () => {
      expect(() => validateExtraKeys([], RESERVED_KEYS_COMMON)).toThrow(
        /must be a dict/
      );
    });

    it('throws RILL-R001 with "must be a dict" for a string', () => {
      expect(() => validateExtraKeys('string', RESERVED_KEYS_COMMON)).toThrow(
        /must be a dict/
      );
    });

    it('throws RILL-R001 with "must be a dict" for a number', () => {
      expect(() => validateExtraKeys(42, RESERVED_KEYS_COMMON)).toThrow(
        /must be a dict/
      );
    });
  });

  describe('EC-19: reserved key collision', () => {
    it("throws RILL-R001 listing 'model' when extra contains 'model'", () => {
      expect(() =>
        validateExtraKeys({ model: 'x' }, RESERVED_KEYS_COMMON)
      ).toThrow(/'model'/);
    });

    it("throws RILL-R001 listing 'temperature' when extra contains 'temperature'", () => {
      expect(() =>
        validateExtraKeys({ temperature: 0.5 }, RESERVED_KEYS_COMMON)
      ).toThrow(/'temperature'/);
    });

    it("throws RILL-R001 listing both 'model' and 'stream' (sorted) for multiple collisions", () => {
      const fn = () =>
        validateExtraKeys(
          { model: 'x', stream: true, foo: 1 },
          RESERVED_KEYS_COMMON
        );
      expect(fn).toThrow(/'model'/);
      expect(fn).toThrow(/'stream'/);
    });

    it('lists colliding keys in sorted order', () => {
      let caught: Error | undefined;
      try {
        validateExtraKeys(
          { stream: true, model: 'x', foo: 1 },
          RESERVED_KEYS_COMMON
        );
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      // 'model' sorts before 'stream'
      expect(caught?.message).toMatch(/'model'.*'stream'/);
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
    it('returns without throwing for a positive integer like 5 (IR-8)', () => {
      expect(() => validateMaxTurns(5)).not.toThrow();
    });

    it('returns without throwing for 1', () => {
      expect(() => validateMaxTurns(1)).not.toThrow();
    });
  });

  describe('EC-21: sentinel value 0', () => {
    it('throws RILL-R001 with sentinel-reserved message for 0', () => {
      expect(() => validateMaxTurns(0)).toThrow(
        /sentinel value 0 is reserved for per-call override semantics/
      );
    });
  });

  describe('EC-22: negative or non-integer', () => {
    it('throws RILL-R001 with positive-integer message for -1', () => {
      expect(() => validateMaxTurns(-1)).toThrow(
        /must be a positive integer or undefined/
      );
    });

    it('throws RILL-R001 with positive-integer message for a float like 2.5', () => {
      expect(() => validateMaxTurns(2.5)).toThrow(
        /must be a positive integer or undefined/
      );
    });

    it('throws for a negative float', () => {
      expect(() => validateMaxTurns(-0.5)).toThrow(
        /must be a positive integer or undefined/
      );
    });
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

  it('throws RILL-R001 for 0', () => {
    expect(() => validateMaxErrors(0)).toThrow(
      /must be a positive integer or undefined/
    );
  });

  it('throws RILL-R001 for a negative integer', () => {
    expect(() => validateMaxErrors(-1)).toThrow(
      /must be a positive integer or undefined/
    );
  });

  it('throws RILL-R001 for a non-integer number', () => {
    expect(() => validateMaxErrors(2.5)).toThrow(
      /must be a positive integer or undefined/
    );
  });

  it('throws RILL-R001 for a non-number value', () => {
    expect(() => validateMaxErrors('3')).toThrow(
      /must be a positive integer or undefined/
    );
  });
});

// ============================================================
// LLMProviderConfig typecheck (IR-8)
// ============================================================

describe('LLMProviderConfig type compatibility', () => {
  it('accepts a config with max_turns, max_errors, and extra fields', () => {
    // This is a compile-time assertion; if TypeScript rejects it, the test file fails to compile.
    const config: LLMProviderConfig = {
      api_key: 'test-key',
      model: 'gpt-4',
      max_turns: 10,
      max_errors: 5,
      extra: { x: 1 },
    };
    expect(config.max_turns).toBe(10);
    expect(config.max_errors).toBe(5);
    expect(config.extra).toEqual({ x: 1 });
  });
});
