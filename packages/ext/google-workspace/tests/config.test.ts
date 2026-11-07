/**
 * Config validation and capability merging tests for Google Workspace extension.
 * Covers: EC-1, EC-2, EC-3, EC-4, BC-9, BC-10, capability defaults, partial merge.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeError } from '@rcrsr/rill';
import { validateConfig, mergeCapabilities } from '../src/config.js';
import type { GoogleWorkspaceConfig } from '../src/types.js';

// ============================================================
// validateConfig
// ============================================================

const PLACEHOLDER_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n';

const BEARER_AUTH = { type: 'bearer', token: 'tok' } as const;

describe('validateConfig', () => {
  describe('rejects invalid config with RILL-R001', () => {
    const invalidCases: readonly {
      readonly label: string;
      readonly config: GoogleWorkspaceConfig;
      readonly message: string;
    }[] = [
      // EC-1: missing or empty auth
      {
        label: 'auth is missing',
        config: {
          auth: undefined as unknown as GoogleWorkspaceConfig['auth'],
        },
        message: 'google: auth is required',
      },
      {
        label: 'bearer token is empty',
        config: { auth: { type: 'bearer', token: '' } },
        message: 'google: auth.token is required',
      },
      {
        label: 'session tokenVar is empty',
        config: { auth: { type: 'session', tokenVar: '' } },
        message: 'google: auth.tokenVar is required',
      },
      {
        label: 'oauth-refresh client_id is empty',
        config: {
          auth: {
            type: 'oauth-refresh',
            client_id: '',
            client_secret: 'csec',
            refresh_token: 'rtok',
          },
        },
        message: 'google: auth.client_id is required',
      },
      {
        label: 'oauth-refresh client_secret is empty',
        config: {
          auth: {
            type: 'oauth-refresh',
            client_id: 'cid',
            client_secret: '',
            refresh_token: 'rtok',
          },
        },
        message: 'google: auth.client_secret is required',
      },
      {
        label: 'oauth-refresh refresh_token is empty',
        config: {
          auth: {
            type: 'oauth-refresh',
            client_id: 'cid',
            client_secret: 'csec',
            refresh_token: '',
          },
        },
        message: 'google: auth.refresh_token is required',
      },
      // EC-2: invalid auth.type
      {
        label: 'auth.type is unsupported',
        config: {
          auth: { type: 'oauth2' as unknown as 'bearer', token: 'tok' },
        },
        message:
          "google: auth.type must be 'bearer', 'session', 'service-account', or 'oauth-refresh'",
      },
      // EC-3: malformed service-account keyJson
      {
        label: 'keyJson is not valid JSON',
        config: { auth: { type: 'service-account', keyJson: 'not-json' } },
        message: 'google: auth.keyJson is invalid: not valid JSON',
      },
      {
        label: 'keyJson is missing client_email',
        config: {
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              private_key: 'pk',
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        },
        message:
          "google: auth.keyJson is invalid: missing field 'client_email'",
      },
      {
        label: 'keyJson has empty client_email',
        config: {
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: '',
              private_key: PLACEHOLDER_PRIVATE_KEY,
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        },
        message:
          "google: auth.keyJson is invalid: missing field 'client_email'",
      },
      {
        label: 'keyJson is missing private_key',
        config: {
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: 'sa@project.iam.gserviceaccount.com',
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        },
        message: "google: auth.keyJson is invalid: missing field 'private_key'",
      },
      {
        label: 'keyJson is missing token_uri',
        config: {
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: 'sa@project.iam.gserviceaccount.com',
              private_key: PLACEHOLDER_PRIVATE_KEY,
            }),
          },
        },
        message: "google: auth.keyJson is invalid: missing field 'token_uri'",
      },
      // EC-4: service config boundary violations
      {
        label: 'gmail.maxResults is 0 (below minimum)',
        config: { auth: BEARER_AUTH, gmail: { maxResults: 0 } },
        message: 'google: gmail.maxResults must be 1-500',
      },
      {
        label: 'gmail.maxResults is 501 (above maximum)',
        config: { auth: BEARER_AUTH, gmail: { maxResults: 501 } },
        message: 'google: gmail.maxResults must be 1-500',
      },
      {
        label: 'drive.maxUploadBytes is 0',
        config: { auth: BEARER_AUTH, drive: { maxUploadBytes: 0 } },
        message: 'google: drive.maxUploadBytes must be positive',
      },
      {
        label: 'drive.maxUploadBytes is negative',
        config: { auth: BEARER_AUTH, drive: { maxUploadBytes: -1 } },
        message: 'google: drive.maxUploadBytes must be positive',
      },
      {
        label: 'drive.allowedFolderIds is an empty array',
        config: { auth: BEARER_AUTH, drive: { allowedFolderIds: [] } },
        message: 'google: drive.allowedFolderIds must be non-empty',
      },
    ];

    it.each(invalidCases)('throws when $label', ({ config, message }) => {
      let caught: unknown;
      try {
        validateConfig(config);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RuntimeError);
      expect((caught as RuntimeError).errorId).toBe('RILL-R001');
      expect((caught as RuntimeError).message).toBe(message);
    });
  });

  describe('accepts valid config', () => {
    const validCases: readonly {
      readonly label: string;
      readonly config: GoogleWorkspaceConfig;
    }[] = [
      {
        label: 'a fully valid bearer config',
        config: { auth: { type: 'bearer', token: 'valid-token' } },
      },
      {
        label: 'a fully valid session config',
        config: { auth: { type: 'session', tokenVar: 'MY_TOKEN_VAR' } },
      },
      {
        label: 'a fully valid service-account config',
        config: {
          auth: {
            type: 'service-account',
            keyJson: JSON.stringify({
              client_email: 'sa@project.iam.gserviceaccount.com',
              private_key: PLACEHOLDER_PRIVATE_KEY,
              token_uri: 'https://oauth2.googleapis.com/token',
            }),
          },
        },
      },
      {
        label: 'a fully valid oauth-refresh config',
        config: {
          auth: {
            type: 'oauth-refresh',
            client_id: 'my-client-id.apps.googleusercontent.com',
            client_secret: 'GOCSPX-abc123',
            refresh_token: '1//refresh-token-value',
          },
        },
      },
      {
        label: 'gmail.maxResults at boundary 1',
        config: { auth: BEARER_AUTH, gmail: { maxResults: 1 } },
      },
      {
        label: 'gmail.maxResults at boundary 500',
        config: { auth: BEARER_AUTH, gmail: { maxResults: 500 } },
      },
      {
        label: 'drive.maxUploadBytes = 1',
        config: { auth: BEARER_AUTH, drive: { maxUploadBytes: 1 } },
      },
      {
        label: 'non-empty drive.allowedFolderIds',
        config: {
          auth: BEARER_AUTH,
          drive: { allowedFolderIds: ['folder-id-1'] },
        },
      },
      // BC-9: undefined allowedLabels is accepted
      {
        label: 'undefined gmail.allowedLabels',
        config: { auth: BEARER_AUTH, gmail: { allowedLabels: undefined } },
      },
      // BC-10: non-empty allowedLabels is accepted (enforcement is in the gmail functions)
      {
        label: 'non-empty gmail.allowedLabels',
        config: {
          auth: BEARER_AUTH,
          gmail: { allowedLabels: ['INBOX', 'SENT'] },
        },
      },
    ];

    it.each(validCases)('accepts $label', ({ config }) => {
      expect(() => validateConfig(config)).not.toThrow();
    });
  });
});

// ============================================================
// mergeCapabilities — defaults and partial override
// ============================================================

describe('mergeCapabilities', () => {
  describe('defaults when no partial provided', () => {
    it('applies the documented default flag for every capability', () => {
      expect(mergeCapabilities()).toEqual({
        gmail: {
          read: true,
          search: true,
          draft: true,
          label: true,
          send: false,
          reply: false,
          modify: false,
        },
        drive: {
          read: true,
          list: true,
          download: true,
          upload: false,
          share: false,
          delete: false,
        },
        calendar: {
          read: true,
          freeBusy: true,
          create: false,
          update: false,
          delete: false,
        },
      });
    });
  });

  describe('partial override merges without destroying unrelated defaults', () => {
    it('enabling gmail.send preserves all other gmail defaults, including read', () => {
      const caps = mergeCapabilities({ gmail: { send: true } });
      expect(caps.gmail.send).toBe(true);
      expect(caps.gmail.read).toBe(true);
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
