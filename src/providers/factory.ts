// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Provider Factory
 *
 * Utility for creating custom LLM providers.
 */

import type { LLMProvider } from '../types.js';
import type { DefineProviderOptions } from './types.js';

/**
 * Create a custom LLM provider.
 *
 * @example
 * ```ts
 * const myProvider = defineProvider({
 *   name: 'my-llm',
 *   supportsVision: true,
 *   supportsThinking: false,
 *   async chat(params) {
 *     // custom implementation
 *     return { content: '...', thinking: null };
 *   },
 * });
 * ```
 */
export function defineProvider(options: DefineProviderOptions): LLMProvider {
  return {
    name: options.name,
    supportsVision: options.supportsVision ?? false,
    supportsThinking: options.supportsThinking ?? false,
    chat: options.chat,
    chatStream: options.chatStream,
  };
}
