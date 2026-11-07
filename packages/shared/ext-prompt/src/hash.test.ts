/**
 * Unit tests for computeContentHash.
 *
 * Covers:
 * SHA-256 hex digest of (params + "\n" + output + "\n" + body)
 * known-vector digest (implies determinism, 64-char length, lowercase hex)
 * different inputs produce different digests
 */

import { describe, it, expect } from 'vitest';
import { computeContentHash } from './hash.js';

describe('computeContentHash', () => {
  describe('output format', () => {
    it('returns the known lowercase hex SHA-256 digest for fixed input', () => {
      // SHA-256 of "params\noutput\nbody", verified via:
      //   printf 'params\noutput\nbody' | sha256sum
      const result = computeContentHash('params', 'output', 'body');
      expect(result).toBe(
        '0194cbe082524911328762aac6e2880289a8e4e0e506e7de24c6f2ae45c98f22'
      );
    });
  });

  describe('different inputs produce different digests', () => {
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
});
