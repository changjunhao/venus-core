// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Anthropic Provider
 *
 * Uses the `@anthropic-ai/sdk` for Anthropic's Messages API.
 * Requires `@anthropic-ai/sdk` as an optional peer dependency.
 * Currently a skeleton — implementation deferred.
 */

import type { LLMProvider } from '../types.js';

/** Options for creating an Anthropic provider */
export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export function createAnthropicProvider(_options: AnthropicProviderOptions): LLMProvider {
  throw new Error('Anthropic provider is not yet implemented');
}
