// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { createVenusEngine } from '../../src/engine.js';
import { defineProvider } from '../../src/providers/index.js';
import type { EvaluationEvent } from '../../src/types.js';
import { createMockProvider } from './mock-provider.js';

/** Mock default provider — never actually called when per-agent providers are set */
const mockDefaultProvider = defineProvider({
  name: 'mock-default',
  chat: async () => ({ content: 'unreachable', reasoning: null }),
});

/**
 * Create a VenusEngine wired with mock providers for each agent role.
 * Each provider consumes responses in order from the given arrays.
 *
 * @param opts.onEvent - Optional callback for engine lifecycle events
 */
export function createMockEngine(opts: {
  proposerResponses: Array<{ content: string; reasoning?: string }>;
  criticResponses: Array<{ content: string; reasoning?: string }>;
  arbiterResponses: Array<{ content: string; reasoning?: string }>;
  onEvent?: (event: EvaluationEvent) => void;
}) {
  return createVenusEngine({
    provider: mockDefaultProvider,
    defaultModel: 'test-model',
    providers: {
      proposer: createMockProvider(opts.proposerResponses),
      critic: createMockProvider(opts.criticResponses),
      arbiter: createMockProvider(opts.arbiterResponses),
    },
    onEvent: opts.onEvent,
  });
}
