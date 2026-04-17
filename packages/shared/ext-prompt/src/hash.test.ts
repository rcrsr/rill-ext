/**
 * Unit tests for computeContentHash.
 *
 * Covers:
 *   IR-6  — SHA-256 hex digest of (params + "\n" + output + "\n" + body)
 *   AC-18 — byte-identical inputs produce equal digests (hash stability)
 *   IR-6  — different inputs produce different digests
 *   IR-6  — result is a 64-character lowercase hex string
 */

import { describe, it, expect } from 'vitest';
import { computeContentHash } from './hash.js';

describe('computeContentHash', () => {
  describe('hash stability (AC-18)', () => {
    it('produces the same digest for identical inputs', () => {
      const a = computeContentHash('params', 'output', 'body');
      const b = computeContentHash('params', 'output', 'body');
      expect(a).toBe(b);
    });

    it('produces the same digest when called multiple times with empty strings', () => {
      expect(computeContentHash('', '', '')).toBe(computeContentHash('', '', ''));
    });
  });

  describe('output format (IR-6)', () => {
    it('returns a 64-character string', () => {
      expect(computeContentHash('p', 'o', 'b')).toHaveLength(64);
    });

    it('returns a lowercase hex string', () => {
      const result = computeContentHash('p', 'o', 'b');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns a known SHA-256 value for deterministic input', () => {
      // SHA-256 of "params\noutput\nbody", verified via:
      //   printf 'params\noutput\nbody' | sha256sum
      const result = computeContentHash('params', 'output', 'body');
      expect(result).toBe('0194cbe082524911328762aac6e2880289a8e4e0e506e7de24c6f2ae45c98f22');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('different inputs produce different digests (IR-6)', () => {
    it('differs when params changes', () => {
      const a = computeContentHash('params-a', 'output', 'body');
      const b = computeContentHash('params-b', 'output', 'body');
      expect(a).not.toBe(b);
    });

    it('differs when output changes', () => {
      const a = computeContentHash('params', 'output-a', 'body');
      const b = computeContentHash('params', 'output-b', 'body');
      expect(a).not.toBe(b);
    });

    it('differs when body changes', () => {
      const a = computeContentHash('params', 'output', 'body-a');
      const b = computeContentHash('params', 'output', 'body-b');
      expect(a).not.toBe(b);
    });

    it('treats newline-separated fields distinctly (no injection)', () => {
      // "p\no" + "\n" + "b" should differ from "p" + "\n" + "o\nb"
      const a = computeContentHash('p\no', '', 'b');
      const b = computeContentHash('p', '', 'o\nb');
      expect(a).not.toBe(b);
    });
  });

  describe('never throws (IR-6)', () => {
    it('handles all-empty inputs without throwing', () => {
      expect(() => computeContentHash('', '', '')).not.toThrow();
    });

    it('handles large inputs without throwing', () => {
      const large = 'x'.repeat(100_000);
      expect(() => computeContentHash(large, large, large)).not.toThrow();
    });
  });
});
