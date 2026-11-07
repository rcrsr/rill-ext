import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { VERSION } from './index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('S3 FS Extension', () => {
  describe('package exports', () => {
    it('exports version matching package.json', () => {
      expect(VERSION).toBe(_pkg.version);
    });
  });
});
