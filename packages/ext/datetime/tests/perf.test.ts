/**
 * Performance benchmark tests for time::format and time::parse.
 *
 * Covers: AC-NF1, AC-NF2
 *
 * Each benchmark runs 1000 sequential calls, collects individual durations,
 * sorts ascending, and asserts that the P99 value (index 989) is below 1 ms.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createDatetimeExtension } from '../src/factory.js';
import { makeFactoryCtx, makeRuntimeCtx } from './_setup.js';

// Fixed datetime: 2026-03-13T08:30:45.123Z
const DT_FIXED = Date.parse('2026-03-13T08:30:45.123Z');

// Pattern used for both format and parse benchmarks
const PATTERN = 'YYYY-MM-DD HH:mm:ss.SSS';

// Formatted string used as parse input
const FORMATTED_STR = '2026-03-13 08:30:45.123';

const CALL_COUNT = 1000;
const P99_INDEX = 989; // 990th element (0-indexed) of 1000 sorted durations
const P99_LIMIT_MS = 1;

const runBenchmarks = process.env.RUN_PERF_BENCHMARKS === 'true';
const describePerf = runBenchmarks ? describe : describe.skip;

function mk() {
  return createDatetimeExtension({}, makeFactoryCtx());
}

describePerf('performance', () => {
  // ============================================================
  // AC-NF1: time::format P99 below 1 ms over 1000 sequential calls
  // ============================================================

  describe('AC-NF1: time::format', () => {
    it('P99 latency is below 1 ms for 1000 sequential calls', async () => {
      const ext = mk();
      const formatFn = ext.value.format.fn;

      const durations: number[] = [];

      for (let i = 0; i < CALL_COUNT; i++) {
        const start = performance.now();
        await formatFn({ dt: DT_FIXED, pattern: PATTERN }, makeRuntimeCtx());
        durations.push(performance.now() - start);
      }

      durations.sort((a, b) => a - b);
      const p99 = durations[P99_INDEX] as number;

      expect(p99).toBeLessThan(P99_LIMIT_MS);
    });
  });

  // ============================================================
  // AC-NF2: time::parse P99 below 1 ms over 1000 sequential calls
  // ============================================================

  describe('AC-NF2: time::parse', () => {
    it('P99 latency is below 1 ms for 1000 sequential calls', async () => {
      const ext = mk();
      const parseFn = ext.value.parse.fn;

      const durations: number[] = [];

      for (let i = 0; i < CALL_COUNT; i++) {
        const start = performance.now();
        await parseFn({ str: FORMATTED_STR, pattern: PATTERN }, makeRuntimeCtx());
        durations.push(performance.now() - start);
      }

      durations.sort((a, b) => a - b);
      const p99 = durations[P99_INDEX] as number;

      expect(p99).toBeLessThan(P99_LIMIT_MS);
    });
  });
});
