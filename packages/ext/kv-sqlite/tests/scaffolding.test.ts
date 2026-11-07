/**
 * Basic scaffolding tests for kv-sqlite package.
 * Verifies package structure and exports.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('Package scaffolding', () => {
  describe('exports', () => {
    it('exports VERSION matching package.json', () => {
      expect(VERSION).toBe(_pkg.version);
    });
  });
});
