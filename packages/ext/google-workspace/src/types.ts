/**
 * Type definitions for Google Workspace extension.
 * Defines configuration and contract types for the Gmail, Drive, and Calendar integrations.
 */

import type { ApplicationCallable, ExtensionFactoryResult } from '@rcrsr/rill';

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * Bearer token authentication.
 * Uses a static OAuth access token for all API requests.
 */
export interface GoogleAuthBearer {
  readonly type: 'bearer';
  /** Static OAuth access token for all requests. */
  readonly token: string;
}

/**
 * Session token authentication.
 * Resolves the Bearer token from RuntimeContext at call time.
 */
export interface GoogleAuthSession {
  readonly type: 'session';
  /** Name of the RuntimeContext variable holding the Bearer token. */
  readonly tokenVar: string;
}

/**
 * Service account authentication.
 * Uses a GCP service account JSON key for server-to-server auth.
 */
export interface GoogleAuthServiceAccount {
  readonly type: 'service-account';
  /** GCP service account key JSON string. */
  readonly keyJson: string;
  /** Optional email address to impersonate via domain-wide delegation. */
  readonly subject?: string | undefined;
}

/**
 * OAuth refresh token authentication.
 * Exchanges a long-lived refresh token for access tokens at call time.
 */
export interface GoogleAuthOauthRefresh {
  readonly type: 'oauth-refresh';
  /** GCP OAuth client ID. */
  readonly client_id: string;
  /** GCP OAuth client secret. */
  readonly client_secret: string;
  /** Long-lived OAuth refresh token. */
  readonly refresh_token: string;
}

/** Authentication configuration for Google Workspace extension (discriminated union on `type`). */
export type GoogleAuth = GoogleAuthBearer | GoogleAuthSession | GoogleAuthServiceAccount | GoogleAuthOauthRefresh;

// ============================================================
// CAPABILITIES
// ============================================================

/** Gmail capability flags. */
export interface GmailCapabilities {
  /** Allow reading messages. */
  readonly read: boolean;
  /** Allow searching messages. */
  readonly search: boolean;
  /** Allow sending messages. */
  readonly send: boolean;
  /** Allow drafting messages. */
  readonly draft: boolean;
  /** Allow replying to messages. */
  readonly reply: boolean;
  /** Allow flagging messages. */
  readonly label: boolean;
  /** Allow modifying message labels. */
  readonly modify: boolean;
}

/** Drive capability flags. */
export interface DriveCapabilities {
  /** Allow reading file contents. */
  readonly read: boolean;
  /** Allow listing files. */
  readonly list: boolean;
  /** Allow uploading files. */
  readonly upload: boolean;
  /** Allow downloading files. */
  readonly download: boolean;
  /** Allow sharing files. */
  readonly share: boolean;
  /** Allow deleting files. */
  readonly delete: boolean;
}

/** Calendar capability flags. */
export interface CalendarCapabilities {
  /** Allow reading events. */
  readonly read: boolean;
  /** Allow creating events. */
  readonly create: boolean;
  /** Allow updating events. */
  readonly update: boolean;
  /** Allow deleting events. */
  readonly delete: boolean;
  /** Allow querying free/busy information. */
  readonly freeBusy: boolean;
}

/** Operation permission flags for Google Workspace extension. */
export interface GoogleCapabilities {
  readonly gmail: GmailCapabilities;
  readonly drive: DriveCapabilities;
  readonly calendar: CalendarCapabilities;
}

// ============================================================
// SERVICE CONFIG
// ============================================================

/** Gmail query constraint options. */
export interface GmailConfig {
  /** Allowlist of accessible Gmail label names. */
  readonly allowedLabels?: string[] | undefined;
  /** Denylist of Gmail label names to exclude. */
  readonly deniedLabels?: string[] | undefined;
  /** Maximum number of results to return per query. */
  readonly maxResults?: number | undefined;
}

/** Drive query constraint options. */
export interface DriveConfig {
  /** Allowlist of accessible folder IDs. */
  readonly allowedFolderIds?: string[] | undefined;
  /** Denylist of MIME types to exclude. */
  readonly deniedMimeTypes?: string[] | undefined;
  /** Maximum allowed upload size in bytes. */
  readonly maxUploadBytes?: number | undefined;
}

/** Calendar query constraint options. */
export interface CalendarConfig {
  /** Allowlist of accessible calendar IDs. */
  readonly allowedCalendarIds?: string[] | undefined;
  /** When true, all-day events are excluded from results. */
  readonly denyAllDay?: boolean | undefined;
}

// ============================================================
// EXTENSION CONFIG
// ============================================================

/**
 * Configuration options for Google Workspace extension.
 *
 * @example
 * ```typescript
 * const config: GoogleWorkspaceConfig = {
 *   auth: { type: 'bearer', token: process.env.GOOGLE_TOKEN },
 *   capabilities: { gmail: { send: true } },
 * };
 * ```
 */
export interface GoogleWorkspaceConfig {
  /** Authentication configuration. Required. */
  readonly auth: GoogleAuth;
  /** Operation permission flags. Merged with defaults when partial. */
  readonly capabilities?: Partial<{
    readonly gmail: Partial<GmailCapabilities>;
    readonly drive: Partial<DriveCapabilities>;
    readonly calendar: Partial<CalendarCapabilities>;
  }> | undefined;
  /** Gmail query constraints. */
  readonly gmail?: GmailConfig | undefined;
  /** Drive query constraints. */
  readonly drive?: DriveConfig | undefined;
  /** Calendar query constraints. */
  readonly calendar?: CalendarConfig | undefined;
}

// ============================================================
// SERVICE ACCOUNT KEY
// ============================================================

/** Parsed fields from a GCP service account key JSON. */
export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri: string;
}

// ============================================================
// CONTRACT
// ============================================================

/**
 * Contract type for Google Workspace extension implementations.
 * Enforces exact function structure for compile-time verification.
 * Maps all 17 host function names to ApplicationCallable.
 */
export type GoogleWorkspaceExtensionContract = {
  // Gmail (7)
  readonly gmail_search: ApplicationCallable;
  readonly gmail_read: ApplicationCallable;
  readonly gmail_send: ApplicationCallable;
  readonly gmail_draft: ApplicationCallable;
  readonly gmail_reply: ApplicationCallable;
  readonly gmail_flag: ApplicationCallable;
  readonly gmail_label: ApplicationCallable;
  // Drive (6)
  readonly drive_list: ApplicationCallable;
  readonly drive_upload: ApplicationCallable;
  readonly drive_download: ApplicationCallable;
  readonly drive_share: ApplicationCallable;
  readonly drive_delete: ApplicationCallable;
  readonly drive_get_metadata: ApplicationCallable;
  // Calendar (4)
  readonly calendar_events: ApplicationCallable;
  readonly calendar_today: ApplicationCallable;
  readonly calendar_create_event: ApplicationCallable;
  readonly calendar_free_busy: ApplicationCallable;
};

/**
 * Re-export for satisfies check usage.
 */
export type { ExtensionFactoryResult };
