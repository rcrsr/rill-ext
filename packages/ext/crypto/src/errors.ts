/**
 * Atom codes registered by the crypto extension.
 *
 * Registered at factory init via `ctx.registerErrorCode`. Host functions
 * raise invalid `RillValue`s carrying these atoms via `ctx.invalidate`.
 *
 * Host scripts can match on these via `.!code == #EXT_CRYPTO_CONFIG`,
 * `guard`, and `retry`.
 */

export const EXT_CRYPTO_CONFIG = 'EXT_CRYPTO_CONFIG';
