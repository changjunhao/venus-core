// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Anthropic Provider
 *
 * Uses the `@anthropic-ai/sdk` for Anthropic's Messages API.
 * Requires `@anthropic-ai/sdk` as an optional peer dependency.
 *
 * @experimental This provider is a skeleton and not yet implemented.
 * Calling `createAnthropicProvider()` will throw. Do not use in production.
 */

import type { LLMProvider } from '../types.js';

/**
 * Options for creating an Anthropic provider.
 * @experimental
 */
export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

/**
 * Create an Anthropic Messages API provider.
 * @experimental Not yet implemented — throws on invocation.
 */
export function createAnthropicProvider(_options: AnthropicProviderOptions): LLMProvider {
  throw new Error('Anthropic provider is not yet implemented');
}
