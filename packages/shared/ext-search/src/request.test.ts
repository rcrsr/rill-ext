/**
 * Test suite for in-flight request tracking utilities.
 * Validates tracking, abort propagation, and cleanup.
 */

import { describe, it, expect } from 'vitest';
import { createInFlightState, trackRequest, abortAll } from './request.js';

describe('createInFlightState', () => {
  it('returns state with empty controllers Set', () => {
    const state = createInFlightState();

    expect(state.controllers).toBeInstanceOf(Set);
    expect(state.controllers.size).toBe(0);
  });
});

describe('trackRequest', () => {
  it('adds controller to the set', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);

    expect(state.controllers.has(controller)).toBe(true);
    expect(state.controllers.size).toBe(1);
  });
});

describe('abortAll', () => {
  it('clears the controllers set after aborting', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);
    abortAll(state);

    expect(state.controllers.size).toBe(0);
  });

  it('is idempotent — second call on empty set causes no error', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);
    abortAll(state);

    expect(() => abortAll(state)).not.toThrow();
    expect(state.controllers.size).toBe(0);
  });

  it('marks all aborted controllers as aborted', () => {
    const state = createInFlightState();
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    trackRequest(state, controller1);
    trackRequest(state, controller2);
    abortAll(state);

    expect(controller1.signal.aborted).toBe(true);
    expect(controller2.signal.aborted).toBe(true);
  });
});
