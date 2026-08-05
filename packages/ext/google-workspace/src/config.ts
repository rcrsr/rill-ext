/**
 * Configuration validation and capability merging for Google Workspace extension.
 * Validates GoogleWorkspaceConfig fields and merges capability defaults.
 */

import { RuntimeError } from '@rcrsr/rill';
import type {
  GoogleCapabilities,
  GoogleWorkspaceConfig,
  ServiceAccountKey,
} from './types.js';

// ============================================================
// DEFAULTS
// ============================================================

/** Default capability flags applied when config.capabilities is absent or partial. */
const DEFAULT_CAPABILITIES: GoogleCapabilities = {
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
};

// ============================================================
// SERVICE ACCOUNT KEY PARSING
// ============================================================

/**
 * Parse and validate a GCP service account key JSON string.
 * Throws RuntimeError RILL-R001 on failure.
 *
 * @param keyJson - Service account key JSON string
 * @returns Parsed ServiceAccountKey with required fields
 * @throws RuntimeError (RILL-R001) on parse failure or missing fields
 */
export function parseServiceAccountKey(keyJson: string): ServiceAccountKey {
  let parsed: unknown;

  try {
    parsed = JSON.parse(keyJson);
  } catch {
    throw new RuntimeError(
      'RILL-R001',
      'google: auth.keyJson is invalid: not valid JSON'
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new RuntimeError(
      'RILL-R001',
      'google: auth.keyJson is invalid: not valid JSON'
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (!obj['client_email'] || typeof obj['client_email'] !== 'string') {
    throw new RuntimeError(
      'RILL-R001',
      "google: auth.keyJson is invalid: missing field 'client_email'"
    );
  }

  if (!obj['private_key'] || typeof obj['private_key'] !== 'string') {
    throw new RuntimeError(
      'RILL-R001',
      "google: auth.keyJson is invalid: missing field 'private_key'"
    );
  }

  if (!obj['token_uri'] || typeof obj['token_uri'] !== 'string') {
    throw new RuntimeError(
      'RILL-R001',
      "google: auth.keyJson is invalid: missing field 'token_uri'"
    );
  }

  return {
    client_email: obj['client_email'] as string,
    private_key: obj['private_key'] as string,
    token_uri: obj['token_uri'] as string,
  };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate GoogleWorkspaceConfig fields.
 * Throws RuntimeError RILL-R001 on any invalid field.
 *
 * @param config - Configuration to validate
 * @throws RuntimeError (RILL-R001) on validation failure
 */
export function validateConfig(config: GoogleWorkspaceConfig): void {
  // Missing auth
  if (!config.auth) {
    throw new RuntimeError('RILL-R001', 'google: auth is required');
  }

  // Invalid auth type
  const authType = config.auth.type;
  if (
    authType !== 'bearer' &&
    authType !== 'session' &&
    authType !== 'service-account' &&
    authType !== 'oauth-refresh'
  ) {
    throw new RuntimeError(
      'RILL-R001',
      "google: auth.type must be 'bearer', 'session', 'service-account', or 'oauth-refresh'"
    );
  }

  // Bearer requires non-empty token
  if (config.auth.type === 'bearer') {
    if (!config.auth.token || config.auth.token === '') {
      throw new RuntimeError('RILL-R001', 'google: auth.token is required');
    }
  }

  // Session requires non-empty tokenVar
  if (config.auth.type === 'session') {
    if (!config.auth.tokenVar || config.auth.tokenVar === '') {
      throw new RuntimeError('RILL-R001', 'google: auth.tokenVar is required');
    }
  }

  // Service account requires valid keyJson
  if (config.auth.type === 'service-account') {
    parseServiceAccountKey(config.auth.keyJson);
  }

  // oauth-refresh requires client_id, client_secret, and refresh_token
  if (config.auth.type === 'oauth-refresh') {
    if (!config.auth.client_id || config.auth.client_id === '') {
      throw new RuntimeError('RILL-R001', 'google: auth.client_id is required');
    }
    if (!config.auth.client_secret || config.auth.client_secret === '') {
      throw new RuntimeError(
        'RILL-R001',
        'google: auth.client_secret is required'
      );
    }
    if (!config.auth.refresh_token || config.auth.refresh_token === '') {
      throw new RuntimeError(
        'RILL-R001',
        'google: auth.refresh_token is required'
      );
    }
  }

  // gmail.maxResults range 1-500
  if (config.gmail?.maxResults !== undefined) {
    const max = config.gmail.maxResults;
    if (!Number.isInteger(max) || max < 1 || max > 500) {
      throw new RuntimeError(
        'RILL-R001',
        'google: gmail.maxResults must be 1-500'
      );
    }
  }

  // drive.maxUploadBytes must be positive
  if (config.drive?.maxUploadBytes !== undefined) {
    const bytes = config.drive.maxUploadBytes;
    if (!Number.isInteger(bytes) || bytes <= 0) {
      throw new RuntimeError(
        'RILL-R001',
        'google: drive.maxUploadBytes must be positive'
      );
    }
  }

  // drive.allowedFolderIds must be non-empty if defined
  if (config.drive?.allowedFolderIds !== undefined) {
    if (config.drive.allowedFolderIds.length === 0) {
      throw new RuntimeError(
        'RILL-R001',
        'google: drive.allowedFolderIds must be non-empty'
      );
    }
  }

  // Mirror: calendar.allowedCalendarIds must be non-empty if defined
  if (config.calendar?.allowedCalendarIds !== undefined) {
    if (config.calendar.allowedCalendarIds.length === 0) {
      throw new RuntimeError(
        'RILL-R001',
        'google: calendar.allowedCalendarIds must be non-empty'
      );
    }
  }
}

// ============================================================
// CAPABILITIES MERGE
// ============================================================

/**
 * Merge partial capabilities config with defaults.
 * Partial fields override defaults; absent fields use defaults.
 *
 * @param partial - Partial capabilities from config
 * @returns Fully merged GoogleCapabilities with all defaults applied
 */
export function mergeCapabilities(
  partial?: Partial<{
    readonly gmail: Partial<{
      readonly read: boolean;
      readonly search: boolean;
      readonly send: boolean;
      readonly draft: boolean;
      readonly reply: boolean;
      readonly label: boolean;
      readonly modify: boolean;
    }>;
    readonly drive: Partial<{
      readonly read: boolean;
      readonly list: boolean;
      readonly upload: boolean;
      readonly download: boolean;
      readonly share: boolean;
      readonly delete: boolean;
    }>;
    readonly calendar: Partial<{
      readonly read: boolean;
      readonly create: boolean;
      readonly update: boolean;
      readonly delete: boolean;
      readonly freeBusy: boolean;
    }>;
  }>
): GoogleCapabilities {
  if (!partial) {
    return DEFAULT_CAPABILITIES;
  }

  return {
    gmail: {
      read: partial.gmail?.read ?? DEFAULT_CAPABILITIES.gmail.read,
      search: partial.gmail?.search ?? DEFAULT_CAPABILITIES.gmail.search,
      send: partial.gmail?.send ?? DEFAULT_CAPABILITIES.gmail.send,
      draft: partial.gmail?.draft ?? DEFAULT_CAPABILITIES.gmail.draft,
      reply: partial.gmail?.reply ?? DEFAULT_CAPABILITIES.gmail.reply,
      label: partial.gmail?.label ?? DEFAULT_CAPABILITIES.gmail.label,
      modify: partial.gmail?.modify ?? DEFAULT_CAPABILITIES.gmail.modify,
    },
    drive: {
      read: partial.drive?.read ?? DEFAULT_CAPABILITIES.drive.read,
      list: partial.drive?.list ?? DEFAULT_CAPABILITIES.drive.list,
      upload: partial.drive?.upload ?? DEFAULT_CAPABILITIES.drive.upload,
      download: partial.drive?.download ?? DEFAULT_CAPABILITIES.drive.download,
      share: partial.drive?.share ?? DEFAULT_CAPABILITIES.drive.share,
      delete: partial.drive?.delete ?? DEFAULT_CAPABILITIES.drive.delete,
    },
    calendar: {
      read: partial.calendar?.read ?? DEFAULT_CAPABILITIES.calendar.read,
      create: partial.calendar?.create ?? DEFAULT_CAPABILITIES.calendar.create,
      update: partial.calendar?.update ?? DEFAULT_CAPABILITIES.calendar.update,
      delete: partial.calendar?.delete ?? DEFAULT_CAPABILITIES.calendar.delete,
      freeBusy:
        partial.calendar?.freeBusy ?? DEFAULT_CAPABILITIES.calendar.freeBusy,
    },
  };
}
