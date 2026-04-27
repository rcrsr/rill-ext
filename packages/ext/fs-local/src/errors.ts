/**
 * Atom codes registered by the fs-local extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_FS_LOCAL_IO`,
 * `guard`, and `retry`.
 */

export const EXT_FS_LOCAL_CONFIG = 'EXT_FS_LOCAL_CONFIG';
export const EXT_FS_LOCAL_IO = 'EXT_FS_LOCAL_IO';
export const EXT_FS_LOCAL_PATH = 'EXT_FS_LOCAL_PATH';
