/**
 * Test suite for in-flight request tracking utilities.
 * Validates IR-4 and AC-42 acceptance criteria.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInFlightState,
  trackRequest,
  abortAll,
} from './request.js';

describe('createInFlightState', () => {
  it('returns state with empty controllers Set (IR-4)', () => {
    const state = createInFlightState();

    expect(state.controllers).toBeInstanceOf(Set);
    expect(state.controllers.size).toBe(0);
  });

  it('creates independent state objects', () => {
    const state1 = createInFlightState();
    const state2 = createInFlightState();

    expect(state1).not.toBe(state2);
    expect(state1.controllers).not.toBe(state2.controllers);
  });
});

describe('trackRequest', () => {
  it('adds controller to the set (IR-4)', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);

    expect(state.controllers.has(controller)).toBe(true);
    expect(state.controllers.size).toBe(1);
  });

  it('tracks multiple controllers (AC-42)', () => {
    const state = createInFlightState();
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    trackRequest(state, controller1);
    trackRequest(state, controller2);

    expect(state.controllers.has(controller1)).toBe(true);
    expect(state.controllers.has(controller2)).toBe(true);
    expect(state.controllers.size).toBe(2);
  });

  it('is a no-op if the controller is already tracked', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);
    trackRequest(state, controller);

    expect(state.controllers.size).toBe(1);
  });
});

describe('abortAll', () => {
  it('calls abort() on all controllers (IR-4)', () => {
    const state = createInFlightState();
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const abort1 = vi.spyOn(controller1, 'abort');
    const abort2 = vi.spyOn(controller2, 'abort');

    trackRequest(state, controller1);
    trackRequest(state, controller2);
    abortAll(state);

    expect(abort1).toHaveBeenCalledTimes(1);
    expect(abort2).toHaveBeenCalledTimes(1);
  });

  it('clears the controllers set after aborting (IR-4)', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);
    abortAll(state);

    expect(state.controllers.size).toBe(0);
  });

  it('is idempotent — second call on empty set causes no error (IR-4)', () => {
    const state = createInFlightState();
    const controller = new AbortController();

    trackRequest(state, controller);
    abortAll(state);

    expect(() => abortAll(state)).not.toThrow();
    expect(state.controllers.size).toBe(0);
  });

  it('is a no-op on empty state', () => {
    const state = createInFlightState();

    expect(() => abortAll(state)).not.toThrow();
    expect(state.controllers.size).toBe(0);
  });

  it('marks all aborted controllers as aborted (AC-42)', () => {
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
