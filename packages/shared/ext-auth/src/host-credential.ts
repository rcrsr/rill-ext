import type { RuntimeContext } from '@rcrsr/rill';

export interface HostCredentialOptions {
  readonly key: string;
  readonly provider: string;
  readonly label: string;
}

/**
 * Reads a session token from the host context. Only an own property counts;
 * script variables are never consulted. Throws an invalid #AUTH value when the
 * key is absent or the value is not a non-empty string.
 */
export function readHostCredential(
  ctx: RuntimeContext,
  options: HostCredentialOptions
): string {
  const { key, provider, label } = options;
  const value: unknown = Object.hasOwn(ctx.hostContext, key)
    ? ctx.hostContext[key]
    : undefined;

  if (typeof value === 'string' && value !== '') {
    return value;
  }

  const absent = value === undefined;
  const kind = absent ? 'session_token_missing' : 'invalid_session_token';
  const message = absent
    ? `${label}: session token '${key}' not found`
    : `${label}: session token '${key}' must be a non-empty string`;
  throw ctx.invalidate(new Error(message), {
    code: 'AUTH',
    provider,
    raw: { kind, message, token_var: key },
  });
}
