/**
 * Config validation and capability merging tests for Google Workspace extension.
 * Covers: EC-1, EC-2, EC-3, EC-4, BC-9, BC-10, capability defaults, partial merge.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { validateConfig, mergeCapabilities } from '../src/config.js';
import type { GoogleWorkspaceConfig } from '../src/types.js';

// ============================================================
// validateConfig — EC-1: Missing / empty auth fields
// ============================================================

describe('validateConfig', () => {
  describe('EC-1: missing or empty auth', () => {
    it('throws RILL-R004 when auth is missing', () => {
      let caught: unknown;
      try {
        validateConfig({ auth: undefined as unknown as GoogleWorkspaceConfig['auth'] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('google: auth is required');
    });

    it('throws RILL-R004 when bearer token is empty', () => {
      let caught: unknown;
      try {
        validateConfig({ auth: { type: 'bearer', token: '' } });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('google: auth.token is required');
    });

    it('throws RILL-R004 when session tokenVar is empty', () => {
      let caught: unknown;
      try {
        validateConfig({ auth: { type: 'session', tokenVar: '' } });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('google: auth.tokenVar is required');
    });
  });

  // ============================================================
  // EC-2: Invalid auth.type
  // ============================================================

  describe('EC-2: invalid auth.type', () => {
    it('throws RILL-R004 for unsupported auth type', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'oauth2' as unknown as 'bearer', token: 'tok' },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        "google: auth.type must be 'bearer', 'session', or 'service-account'"
      );
    });
  });

  // ============================================================
  // EC-3: Malformed service-account keyJson
  // ============================================================

  describe('EC-3: malformed auth.keyJson', () => {
    it('throws RILL-R004 when keyJson is not valid JSON', () => {
      let caught: unknown;
      try {
        validateConfig({ auth: { type: 'service-account', keyJson: 'not-json' } });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        'google: auth.keyJson is invalid: not valid JSON'
      );
    });

    it('throws RILL-R004 when keyJson is missing client_email', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              private_key: 'pk',
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        "google: auth.keyJson is invalid: missing field 'client_email'"
      );
    });

    it('throws RILL-R004 when keyJson is missing private_key', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: 'sa@project.iam.gserviceaccount.com',
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        "google: auth.keyJson is invalid: missing field 'private_key'"
      );
    });

    it('throws RILL-R004 when keyJson is missing token_uri', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: 'sa@project.iam.gserviceaccount.com',
              private_key: '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
            }),
          },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        "google: auth.keyJson is invalid: missing field 'token_uri'"
      );
    });
  });

  // ============================================================
  // EC-4: Service config boundary violations
  // ============================================================

  describe('EC-4: service config boundaries', () => {
    it('throws RILL-R004 when gmail.maxResults is 0 (below minimum)', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { maxResults: 0 },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('google: gmail.maxResults must be 1-500');
    });

    it('throws RILL-R004 when gmail.maxResults is 501 (above maximum)', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { maxResults: 501 },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe('google: gmail.maxResults must be 1-500');
    });

    it('throws RILL-R004 when drive.maxUploadBytes is 0', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          drive: { maxUploadBytes: 0 },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        'google: drive.maxUploadBytes must be positive'
      );
    });

    it('throws RILL-R004 when drive.maxUploadBytes is negative', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          drive: { maxUploadBytes: -1 },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        'google: drive.maxUploadBytes must be positive'
      );
    });

    it('throws RILL-R004 when drive.allowedFolderIds is empty array', () => {
      let caught: unknown;
      try {
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          drive: { allowedFolderIds: [] },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R004');
      expect((caught as RuntimeError).message).toBe(
        'google: drive.allowedFolderIds must be non-empty'
      );
    });
  });

  // ============================================================
  // Valid configs accepted
  // ============================================================

  describe('valid configs', () => {
    it('accepts a fully valid bearer config', () => {
      expect(() =>
        validateConfig({ auth: { type: 'bearer', token: 'valid-token' } })
      ).not.toThrow();
    });

    it('accepts a fully valid session config', () => {
      expect(() =>
        validateConfig({ auth: { type: 'session', tokenVar: 'MY_TOKEN_VAR' } })
      ).not.toThrow();
    });

    it('accepts a fully valid service-account config', () => {
      const keyJson = JSON.stringify({
        client_email: 'sa@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
        token_uri: 'https://oauth2.googleapis.com/token',
      });
      expect(() =>
        validateConfig({ auth: { type: 'service-account', keyJson } })
      ).not.toThrow();
    });

    it('accepts bearer config with gmail.maxResults at boundary 1', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { maxResults: 1 },
        })
      ).not.toThrow();
    });

    it('accepts bearer config with gmail.maxResults at boundary 500', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { maxResults: 500 },
        })
      ).not.toThrow();
    });

    it('accepts bearer config with drive.maxUploadBytes = 1', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          drive: { maxUploadBytes: 1 },
        })
      ).not.toThrow();
    });

    it('accepts bearer config with non-empty allowedFolderIds', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          drive: { allowedFolderIds: ['folder-id-1'] },
        })
      ).not.toThrow();
    });

    // BC-9: undefined allowedLabels is accepted
    it('accepts config when gmail.allowedLabels is undefined (BC-9)', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { allowedLabels: undefined },
        })
      ).not.toThrow();
    });

    // BC-10: non-empty allowedLabels is accepted (enforcement is in 3.1)
    it('accepts config when gmail.allowedLabels is non-empty (BC-10)', () => {
      expect(() =>
        validateConfig({
          auth: { type: 'bearer', token: 'tok' },
          gmail: { allowedLabels: ['INBOX', 'SENT'] },
        })
      ).not.toThrow();
    });
  });
});

// ============================================================
// mergeCapabilities — defaults and partial override
// ============================================================

describe('mergeCapabilities', () => {
  describe('defaults when no partial provided', () => {
    it('applies gmail defaults: read, search, draft, label = true', () => {
      const caps = mergeCapabilities();
      expect(caps.gmail.read).toBe(true);
      expect(caps.gmail.search).toBe(true);
      expect(caps.gmail.draft).toBe(true);
      expect(caps.gmail.label).toBe(true);
    });

    it('applies gmail defaults: send, reply, modify = false', () => {
      const caps = mergeCapabilities();
      expect(caps.gmail.send).toBe(false);
      expect(caps.gmail.reply).toBe(false);
      expect(caps.gmail.modify).toBe(false);
    });

    it('applies drive defaults: read, list, download = true', () => {
      const caps = mergeCapabilities();
      expect(caps.drive.read).toBe(true);
      expect(caps.drive.list).toBe(true);
      expect(caps.drive.download).toBe(true);
    });

    it('applies drive defaults: upload, share, delete = false', () => {
      const caps = mergeCapabilities();
      expect(caps.drive.upload).toBe(false);
      expect(caps.drive.share).toBe(false);
      expect(caps.drive.delete).toBe(false);
    });

    it('applies calendar defaults: read, freeBusy = true', () => {
      const caps = mergeCapabilities();
      expect(caps.calendar.read).toBe(true);
      expect(caps.calendar.freeBusy).toBe(true);
    });

    it('applies calendar defaults: create, update, delete = false', () => {
      const caps = mergeCapabilities();
      expect(caps.calendar.create).toBe(false);
      expect(caps.calendar.update).toBe(false);
      expect(caps.calendar.delete).toBe(false);
    });
  });

  describe('partial override merges without destroying unrelated defaults', () => {
    it('enabling gmail.send preserves gmail.read default true', () => {
      const caps = mergeCapabilities({ gmail: { send: true } });
      expect(caps.gmail.send).toBe(true);
      expect(caps.gmail.read).toBe(true);
    });

    it('enabling gmail.send preserves all other gmail defaults', () => {
      const caps = mergeCapabilities({ gmail: { send: true } });
      expect(caps.gmail.search).toBe(true);
      expect(caps.gmail.draft).toBe(true);
      expect(caps.gmail.label).toBe(true);
      expect(caps.gmail.reply).toBe(false);
      expect(caps.gmail.modify).toBe(false);
    });

    it('partial drive override preserves unrelated drive defaults', () => {
      const caps = mergeCapabilities({ drive: { upload: true } });
      expect(caps.drive.upload).toBe(true);
      expect(caps.drive.read).toBe(true);
      expect(caps.drive.list).toBe(true);
      expect(caps.drive.download).toBe(true);
      expect(caps.drive.share).toBe(false);
      expect(caps.drive.delete).toBe(false);
    });

    it('partial calendar override preserves unrelated calendar defaults', () => {
      const caps = mergeCapabilities({ calendar: { create: true } });
      expect(caps.calendar.create).toBe(true);
      expect(caps.calendar.read).toBe(true);
      expect(caps.calendar.freeBusy).toBe(true);
      expect(caps.calendar.update).toBe(false);
      expect(caps.calendar.delete).toBe(false);
    });

    it('disabling a default-true flag works correctly', () => {
      const caps = mergeCapabilities({ gmail: { read: false } });
      expect(caps.gmail.read).toBe(false);
      // Other defaults remain
      expect(caps.gmail.search).toBe(true);
    });

    it('overriding gmail does not change drive or calendar defaults', () => {
      const caps = mergeCapabilities({ gmail: { send: true } });
      expect(caps.drive.read).toBe(true);
      expect(caps.drive.upload).toBe(false);
      expect(caps.calendar.read).toBe(true);
      expect(caps.calendar.create).toBe(false);
    });
  });
});
