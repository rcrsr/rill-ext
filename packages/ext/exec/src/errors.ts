/**
 * Atom codes registered by the exec extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_EXEC_CONFIG`,
 * `guard`, and `retry`.
 */

export const EXT_EXEC_CONFIG = 'EXT_EXEC_CONFIG';
export const EXT_EXEC_TIMEOUT = 'EXT_EXEC_TIMEOUT';
