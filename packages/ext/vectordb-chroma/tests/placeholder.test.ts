import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('ChromaDB Extension Scaffold', () => {
  it('exports VERSION matching package.json', () => {
    expect(VERSION).toBe(_pkg.version);
  });
});
