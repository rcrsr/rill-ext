/**
 * Atom codes registered by the datetime extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_DATETIME_CONFIG`,
 * `guard`, and `retry`.
 */

export const EXT_DATETIME_CONFIG = 'EXT_DATETIME_CONFIG';
