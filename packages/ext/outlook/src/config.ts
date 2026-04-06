/**
 * Configuration validation and token resolution for Outlook extension.
 * Validates OutlookConfig fields and merges capability defaults.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RuntimeContext } from '@rcrsr/rill';
import type {
  OutlookAuth,
  OutlookCapabilities,
  OutlookConfig,
} from './types.js';

// ============================================================
// DEFAULTS
// ============================================================

/** Default capability flags applied when config.capabilities is absent or partial. */
const DEFAULT_CAPABILITIES: OutlookCapabilities = {
  mail: {
    read: true,
    send: false,
    draft: true,
    flag: true,
    search: true,
  },
  calendar: {
    read: true,
    create: false,
  },
};

/** Default mail maxResults when not specified. */
export const DEFAULT_MAX_RESULTS = 50;

/** Default mail folders allowlist when not specified. */
export const DEFAULT_FOLDERS: readonly string[] = ['inbox'];

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate OutlookConfig fields.
 * Throws RuntimeError RILL-R004 on any invalid field.
 *
 * @param config - Configuration to validate
 * @throws RuntimeError (RILL-R004) on validation failure
 */
export function validateConfig(config: OutlookConfig): void {
  // EC-1: Missing auth
  if (!config.auth) {
    throw new RuntimeError('RILL-R004', 'outlook: auth is required');
  }

  // EC-1: Invalid auth type
  if (config.auth.type !== 'bearer' && config.auth.type !== 'session') {
    throw new RuntimeError(
      'RILL-R004',
      "outlook: auth.type must be 'bearer' or 'session'"
    );
  }

  // EC-1: Bearer requires non-empty token
  if (config.auth.type === 'bearer') {
    if (!config.auth.token || config.auth.token === '') {
      throw new RuntimeError('RILL-R004', 'outlook: auth.token is required');
    }
  }

  // EC-1: Session requires non-empty tokenVar
  if (config.auth.type === 'session') {
    if (!config.auth.tokenVar || config.auth.tokenVar === '') {
      throw new RuntimeError('RILL-R004', 'outlook: auth.tokenVar is required');
    }
  }

  // EC-1: maxResults range 1-1000
  if (config.mail?.maxResults !== undefined) {
    const max = config.mail.maxResults;
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      throw new RuntimeError(
        'RILL-R004',
        'outlook: maxResults must be 1-1000'
      );
    }
  }

  // EC-1: folders must be non-empty array if provided
  if (config.mail?.folders !== undefined) {
    if (!Array.isArray(config.mail.folders) || config.mail.folders.length === 0) {
      throw new RuntimeError(
        'RILL-R004',
        'outlook: folders must be non-empty'
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
 * @returns Fully merged OutlookCapabilities with all defaults applied
 */
export function mergeCapabilities(
  partial?: Partial<{
    readonly mail: Partial<{
      readonly read: boolean;
      readonly send: boolean;
      readonly draft: boolean;
      readonly flag: boolean;
      readonly search: boolean;
    }>;
    readonly calendar: Partial<{
      readonly read: boolean;
      readonly create: boolean;
    }>;
  }>
): OutlookCapabilities {
  if (!partial) {
    return DEFAULT_CAPABILITIES;
  }

  return {
    mail: {
      read: partial.mail?.read ?? DEFAULT_CAPABILITIES.mail.read,
      send: partial.mail?.send ?? DEFAULT_CAPABILITIES.mail.send,
      draft: partial.mail?.draft ?? DEFAULT_CAPABILITIES.mail.draft,
      flag: partial.mail?.flag ?? DEFAULT_CAPABILITIES.mail.flag,
      search: partial.mail?.search ?? DEFAULT_CAPABILITIES.mail.search,
    },
    calendar: {
      read: partial.calendar?.read ?? DEFAULT_CAPABILITIES.calendar.read,
      create: partial.calendar?.create ?? DEFAULT_CAPABILITIES.calendar.create,
    },
  };
}

// ============================================================
// TOKEN RESOLUTION
// ============================================================

/**
 * Resolve the Bearer token for Graph API requests.
 * Bearer mode returns config.token directly.
 * Session mode reads the variable from RuntimeContext, walking the parent chain.
 *
 * @param auth - Authentication configuration
 * @param ctx - RuntimeContext for session variable lookup
 * @returns Resolved Bearer token string
 * @throws RuntimeError (RILL-R004) if session token variable not found
 */
export function resolveToken(auth: OutlookAuth, ctx: RuntimeContext): string {
  if (auth.type === 'bearer') {
    return auth.token;
  }

  // Session mode: walk the context parent chain to find the variable
  const tokenVar = auth.tokenVar;
  let scope: RuntimeContext | undefined = ctx;

  while (scope !== undefined) {
    const value = scope.variables.get(tokenVar);
    if (value !== undefined) {
      return String(value);
    }
    scope = scope.parent;
  }

  // EC-11: Session token not found in context
  throw new RuntimeError(
    'RILL-R004',
    `outlook: session token '${tokenVar}' not found`
  );
}
