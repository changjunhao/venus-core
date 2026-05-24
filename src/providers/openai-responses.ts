// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Responses Provider
 *
 * Uses OpenAI's `/v1/responses` API for reasoning-capable models.
 *
 * @experimental This provider is a skeleton and not yet implemented.
 * Calling `createOpenAIResponsesProvider()` will throw. Do not use in production.
 */

import type { LLMProvider } from '../types.js';

/**
 * Options for creating an OpenAI Responses provider.
 * @experimental
 */
export interface OpenAIResponsesProviderOptions {
  baseURL: string;
  apiKey: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Create an OpenAI Responses API provider.
 * @experimental Not yet implemented — throws on invocation.
 */
export function createOpenAIResponsesProvider(_options: OpenAIResponsesProviderOptions): LLMProvider {
  throw new Error('OpenAI Responses provider is not yet implemented');
}
