// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type { VenusEngine } from '../../src/engine.js';
import { MOCK_EVALUATION_RESULT, MOCK_STREAM_EVENTS } from './mock-data.js';

/**
 * Overrides for the mock adapter engine factory.
 * Allows tests to substitute the `evaluate` and/or `evaluateStream` methods.
 */
export interface MockAdapterEngineOverrides {
  evaluate?: VenusEngine['evaluate'];
  evaluateStream?: VenusEngine['evaluateStream'];
}

/**
 * Build a minimal VenusEngine stub for adapter integration tests.
 *
 * By default, `evaluate()` resolves with {@link MOCK_EVALUATION_RESULT} and
 * `evaluateStream()` yields {@link MOCK_STREAM_EVENTS} in order. Either method
 * can be overridden to simulate engine errors or custom event sequences.
 */
export function createMockEngine(overrides?: MockAdapterEngineOverrides): VenusEngine {
  return {
    evaluate: overrides?.evaluate ?? (async () => MOCK_EVALUATION_RESULT),
    evaluateStream:
      overrides?.evaluateStream ??
      async function* () {
        for (const event of MOCK_STREAM_EVENTS) {
          yield event;
        }
      },
  } as unknown as VenusEngine;
}

// Re-export shared mock data so adapter tests only need one import path.
export { MOCK_EVALUATION_RESULT, MOCK_STREAM_EVENTS };
