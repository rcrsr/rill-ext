import type { InFlightState } from './types.js';

/**
 * Create a mutable in-flight request state tracker initialized with an empty set.
 * @returns InFlightState object with an empty controllers Set
 */
export function createInFlightState(): InFlightState {
  return { controllers: new Set() };
}

/**
 * Register an AbortController with the in-flight state.
 * No-op if the controller is already present.
 *
 * @param state - InFlightState object to update
 * @param controller - AbortController for the in-flight request
 */
export function trackRequest(state: InFlightState, controller: AbortController): void {
  state.controllers.add(controller);
}

/**
 * Abort all in-flight requests and clear the controller set.
 * Calling .abort() on an already-aborted controller is a no-op per the AbortController spec.
 * Calling on an empty set is also a no-op.
 *
 * @param state - InFlightState object to drain
 */
export function abortAll(state: InFlightState): void {
  for (const controller of state.controllers) {
    controller.abort();
  }
  state.controllers.clear();
}
