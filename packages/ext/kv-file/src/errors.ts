/**
 * Atom codes registered by the kv-file extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_KV_FILE_CONFIG`,
 * `guard`, and `retry`.
 */

export const EXT_KV_FILE_CONFIG = 'EXT_KV_FILE_CONFIG';
export const EXT_KV_FILE_IO = 'EXT_KV_FILE_IO';
