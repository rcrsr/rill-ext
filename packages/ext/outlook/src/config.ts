/**
 * Configuration validation and token resolution for Outlook extension.
 * Validates OutlookConfig fields and merges capability defaults.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { RillValue, RuntimeContext } from '@rcrsr/rill';
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

const PROVIDER = 'outlook';

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate OutlookConfig fields at factory time.
 * Throws RuntimeError(RILL-R001) on any invalid field.
 */
export function validateConfig(config: OutlookConfig): void {
  if (!config.auth) {
    throw new RuntimeError('RILL-R001', 'outlook: auth is required');
  }

  if (config.auth.type !== 'bearer' && config.auth.type !== 'session') {
    throw new RuntimeError(
      'RILL-R001',
      "outlook: auth.type must be 'bearer' or 'session'"
    );
  }

  if (config.auth.type === 'bearer') {
    if (!config.auth.token || config.auth.token === '') {
      throw new RuntimeError('RILL-R001', 'outlook: auth.token is required');
    }
  }

  if (config.auth.type === 'session') {
    if (!config.auth.tokenVar || config.auth.tokenVar === '') {
      throw new RuntimeError('RILL-R001', 'outlook: auth.tokenVar is required');
    }
  }

  if (config.mail?.maxResults !== undefined) {
    const max = config.mail.maxResults;
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      throw new RuntimeError('RILL-R001', 'outlook: maxResults must be 1-1000');
    }
  }

  if (config.mail?.folders !== undefined) {
    if (
      !Array.isArray(config.mail.folders) ||
      config.mail.folders.length === 0
    ) {
      throw new RuntimeError('RILL-R001', 'outlook: folders must be non-empty');
    }
  }
}

// ============================================================
// CAPABILITIES MERGE
// ============================================================

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
 * Throws an invalid RillValue (`#AUTH`) when a session token variable is
 * not found; the wrap()'s catch passes it through unchanged.
 */
export function resolveToken(auth: OutlookAuth, ctx: RuntimeContext): string {
  if (auth.type === 'bearer') {
    return auth.token;
  }

  const tokenVar = auth.tokenVar;
  let scope: RuntimeContext | undefined = ctx;

  while (scope !== undefined) {
    const value = scope.variables.get(tokenVar);
    if (value !== undefined) {
      return String(value);
    }
    scope = scope.parent;
  }

  const message = `outlook: session token '${tokenVar}' not found`;
  throw ctx.invalidate(new Error(message), {
    code: 'AUTH',
    provider: PROVIDER,
    raw: { kind: 'session_token_missing', tokenVar, message },
  }) as unknown as RillValue;
}
