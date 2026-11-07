/**
 * Tests for OpenAI extension barrel exports and package structure.
 * Verifies the barrel exports, package metadata, and entry points.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import * as openaiExtension from './index.js';

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json') as { version: string };

describe('OpenAI Extension Package', () => {
  describe('Barrel Exports', () => {
    it('exports VERSION matching package.json', () => {
      expect(openaiExtension.VERSION).toBe(_pkg.version);
    });

    it('exports createOpenAIExtension factory', () => {
      expect(openaiExtension.createOpenAIExtension).toBeDefined();
      expect(typeof openaiExtension.createOpenAIExtension).toBe('function');
    });
  });
});
