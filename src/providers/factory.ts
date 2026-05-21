// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Provider Factory
 *
 * Utility for creating custom LLM providers.
 */

import type { LLMProvider, ProviderCapabilities } from '../types.js';
import type { DefineProviderOptions } from './types.js';

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  reasoning: false,
  reasoningBudget: false,
  vision: false,
  streaming: false,
};

/**
 * Create a custom LLM provider.
 *
 * @example
 * ```ts
 * const myProvider = defineProvider({
 *   name: 'my-llm',
 *   capabilities: { vision: true, reasoning: false },
 *   async chat(params) {
 *     // custom implementation
 *     return { content: '...', reasoning: null };
 *   },
 * });
 * ```
 */
export function defineProvider(options: DefineProviderOptions): LLMProvider {
  const capabilities: ProviderCapabilities = {
    ...DEFAULT_CAPABILITIES,
    // Streaming capability inferred from presence of chatStream when not explicitly set
    streaming: options.chatStream !== undefined,
    ...options.capabilities,
  };

  return {
    name: options.name,
    capabilities,
    chat: options.chat,
    chatStream: options.chatStream,
  };
}
