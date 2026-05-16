// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { createVenusEngine } from '../../src/engine.js';
import type { EvaluationEvent } from '../../src/types.js';
import { createMockProvider } from './mock-provider.js';

/**
 * Create a VenusEngine wired with mock providers for each agent role.
 * Each provider consumes responses in order from the given arrays.
 *
 * @param opts.onEvent - Optional callback for engine lifecycle events
 */
export function createMockEngine(opts: {
  proposerResponses: Array<{ content: string; thinking?: string }>;
  criticResponses: Array<{ content: string; thinking?: string }>;
  arbiterResponses: Array<{ content: string; thinking?: string }>;
  onEvent?: (event: EvaluationEvent) => void;
}) {
  return createVenusEngine({
    baseURL: 'https://mock.test/v1',
    apiKey: 'mock-key',
    providers: {
      proposer: createMockProvider(opts.proposerResponses),
      critic: createMockProvider(opts.criticResponses),
      arbiter: createMockProvider(opts.arbiterResponses),
    },
    onEvent: opts.onEvent,
  });
}
