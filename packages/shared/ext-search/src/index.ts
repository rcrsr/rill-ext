// ============================================================
// TYPES
// ============================================================
export type {
  SearchExtensionConfig,
  DisposalState,
  InFlightState,
} from './types.js';

// ============================================================
// VALIDATION
// ============================================================
export { assertRequired, validateBaseUrl } from './validation.js';

// ============================================================
// DISPOSAL
// ============================================================
export { createDisposalState, checkDisposed, dispose } from './disposal.js';

// ============================================================
// IN-FLIGHT REQUEST TRACKING
// ============================================================
export { createInFlightState, trackRequest, abortAll } from './request.js';

// ============================================================
// ERROR MAPPING
// ============================================================
export { mapSearchError, mapProviderSearchError } from './errors.js';

// ============================================================
// EVENT EMISSION
// ============================================================
export { emitSuccessEvent, emitErrorEvent } from './events.js';

// ============================================================
// FUNCTION WRAPPER
// ============================================================
export type { WrapFunction } from './wrapper.js';
export { createSearchFunctionWrapper } from './wrapper.js';
