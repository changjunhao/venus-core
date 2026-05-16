// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { defineProvider } from '../../src/providers/index.js';
import type { LLMProvider } from '../../src/types.js';

/**
 * Create a mock LLM provider that returns responses in order from the given array.
 * Each call consumes one response; when exhausted, throws an error.
 *
 * @param responses - Array of mock responses, each with `content` and optional `thinking`
 * @param opts.name - Custom provider name (default: 'mock-provider')
 */
export function createMockProvider(
  responses: Array<{ content: string; thinking?: string }>,
  opts?: { name?: string },
): LLMProvider {
  let callIndex = 0;
  return defineProvider({
    name: opts?.name ?? 'mock-provider',
    supportsVision: true,
    supportsThinking: true,
    chat: async (_params) => {
      if (callIndex >= responses.length) {
        throw new Error(`Mock provider exhausted at call #${callIndex + 1}`);
      }
      const resp = responses[callIndex++]!;
      return { content: resp.content, thinking: resp.thinking ?? null };
    },
  });
}
