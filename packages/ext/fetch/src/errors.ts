/**
 * Atom codes registered by the fetch extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_FETCH_HTTP`,
 * `guard`, and `retry`.
 */

export const EXT_FETCH_CONFIG = 'EXT_FETCH_CONFIG';
export const EXT_FETCH_HTTP = 'EXT_FETCH_HTTP';
export const EXT_FETCH_TIMEOUT = 'EXT_FETCH_TIMEOUT';
