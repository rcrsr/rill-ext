/**
 * Factory tests for Exa search extension.
 * Validates config validation, factory shape, and dispose lifecycle.
 * Covers: AC-1, AC-14, AC-34, AC-35, EC-13.
 */

import { describe, it, expect } from 'vitest';
import {
  RuntimeError,
  type ApplicationCallable,
  type ExtensionFactoryCtx,
} from '@rcrsr/rill';
import { createExaExtension } from '../src/factory.js';

function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}

// ============================================================
// TEST HELPERS
// ============================================================

function getCallable(
  ext: { value: unknown },
  name: string
): ApplicationCallable {
  return (ext.value as Record<string, ApplicationCallable>)[name]!;
}

// ============================================================
// TESTS
// ============================================================

describe('createExaExtension', () => {
  describe('configuration validation', () => {
    it('throws RILL-R001 for missing apiKey', () => {
      let caught: unknown;
      try {
        createExaExtension(
          { apiKey: undefined as unknown as string },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toContain('apiKey is required');
    });

    it('throws RILL-R001 for invalid baseUrl (non-http)', () => {
      let caught: unknown;
      try {
        createExaExtension(
          { apiKey: 'test-key', baseUrl: 'ftp://bad.example.com' },
          makeFactoryCtx()
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
    });
  });

  describe('factory shape [AC-1]', () => {
    it('search has query (string) param and options (dict) param', () => {
      const ext = createExaExtension(
        { apiKey: 'exa-test-key' },
        makeFactoryCtx()
      );
      const search = getCallable(ext, 'search');
      expect(search.params[0]).toMatchObject({
        name: 'query',
        type: { kind: 'string' },
      });
      expect(search.params[1]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });

    it('contents has urls (tuple) param and options (dict) param', () => {
      const ext = createExaExtension(
        { apiKey: 'exa-test-key' },
        makeFactoryCtx()
      );
      const contents = getCallable(ext, 'contents');
      expect(contents.params[0]).toMatchObject({
        name: 'urls',
        type: { kind: 'tuple' },
      });
      expect(contents.params[1]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });

    it('find_similar has url (string) param and options (dict) param', () => {
      const ext = createExaExtension(
        { apiKey: 'exa-test-key' },
        makeFactoryCtx()
      );
      const findSimilar = getCallable(ext, 'find_similar');
      expect(findSimilar.params[0]).toMatchObject({
        name: 'url',
        type: { kind: 'string' },
      });
      expect(findSimilar.params[1]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });

    it('answer has query (string) param and options (dict) param', () => {
      const ext = createExaExtension(
        { apiKey: 'exa-test-key' },
        makeFactoryCtx()
      );
      const answer = getCallable(ext, 'answer');
      expect(answer.params[0]).toMatchObject({
        name: 'query',
        type: { kind: 'string' },
      });
      expect(answer.params[1]).toMatchObject({
        name: 'options',
        type: { kind: 'dict' },
      });
    });
  });
});
