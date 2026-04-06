/**
 * Type definitions for Outlook extension.
 * Defines configuration and contract types for the Microsoft Graph API integration.
 */

import type { ApplicationCallable, ExtensionFactoryResult } from '@rcrsr/rill';

// ============================================================
// AUTHENTICATION
// ============================================================

/**
 * Bearer token authentication.
 * Uses a static token for all Graph API requests.
 */
export interface OutlookAuthBearer {
  readonly type: 'bearer';
  /** Static Bearer token for all requests. */
  readonly token: string;
}

/**
 * Session token authentication.
 * Resolves the Bearer token from RuntimeContext at call time.
 */
export interface OutlookAuthSession {
  readonly type: 'session';
  /** Name of the RuntimeContext variable holding the Bearer token. */
  readonly tokenVar: string;
}

/** Authentication configuration for Outlook extension (discriminated union on `type`). */
export type OutlookAuth = OutlookAuthBearer | OutlookAuthSession;

// ============================================================
// CAPABILITIES
// ============================================================

/** Mail capability flags. */
export interface OutlookMailCapabilities {
  /** Allow reading inbox, from, read operations. Default: true */
  readonly read: boolean;
  /** Allow send and reply operations. Default: false */
  readonly send: boolean;
  /** Allow draft operations. Default: true */
  readonly draft: boolean;
  /** Allow flag operations. Default: true */
  readonly flag: boolean;
  /** Allow search operations. Default: true */
  readonly search: boolean;
}

/** Calendar capability flags. */
export interface OutlookCalendarCapabilities {
  /** Allow reading events, today, free_busy. Default: true */
  readonly read: boolean;
  /** Allow create_event. Default: false */
  readonly create: boolean;
}

/** Operation permission flags for Outlook extension. */
export interface OutlookCapabilities {
  readonly mail: OutlookMailCapabilities;
  readonly calendar: OutlookCalendarCapabilities;
}

// ============================================================
// MAIL CONFIG
// ============================================================

/** Mail query constraint options. */
export interface OutlookMailConfig {
  /**
   * Maximum number of results to return per query.
   * Range: 1-1000 (Graph API $top limit). Default: 50
   */
  readonly maxResults?: number | undefined;
  /**
   * Allowlist of accessible folder names.
   * Default: ['inbox']
   */
  readonly folders?: string[] | undefined;
}

// ============================================================
// EXTENSION CONFIG
// ============================================================

/**
 * Configuration options for Outlook extension.
 *
 * @example
 * ```typescript
 * const config: OutlookConfig = {
 *   auth: { type: 'bearer', token: process.env.OUTLOOK_TOKEN },
 *   capabilities: { mail: { send: true } },
 * };
 * ```
 */
export interface OutlookConfig {
  /** Authentication configuration. Required. */
  readonly auth: OutlookAuth;
  /** Operation permission flags. Merged with defaults when partial. */
  readonly capabilities?: Partial<{
    readonly mail: Partial<OutlookMailCapabilities>;
    readonly calendar: Partial<OutlookCalendarCapabilities>;
  }> | undefined;
  /** Mail query constraints. */
  readonly mail?: OutlookMailConfig | undefined;
  /**
   * Shared mailbox user ID or UPN.
   * When undefined, uses /me/ endpoint.
   */
  readonly mailbox?: string | undefined;
}

// ============================================================
// CONTRACT
// ============================================================

/**
 * Contract type for Outlook extension implementations.
 * Enforces exact function structure for compile-time verification.
 * Maps all 12 host function names to ApplicationCallable.
 */
export type OutlookExtensionContract = {
  readonly inbox: ApplicationCallable;
  readonly from: ApplicationCallable;
  readonly search: ApplicationCallable;
  readonly read: ApplicationCallable;
  readonly send: ApplicationCallable;
  readonly reply: ApplicationCallable;
  readonly draft: ApplicationCallable;
  readonly flag: ApplicationCallable;
  readonly events: ApplicationCallable;
  readonly today: ApplicationCallable;
  readonly free_busy: ApplicationCallable;
  readonly create_event: ApplicationCallable;
};

/**
 * Re-export for satisfies check usage.
 */
export type { ExtensionFactoryResult };
