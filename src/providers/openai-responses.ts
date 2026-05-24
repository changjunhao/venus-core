// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - OpenAI Responses Provider
 *
 * Uses OpenAI's `/v1/responses` API for reasoning-capable models.
 * Currently a skeleton — implementation deferred.
 */

import type { LLMProvider } from '../types.js';

/** Options for creating an OpenAI Responses provider */
export interface OpenAIResponsesProviderOptions {
  baseURL: string;
  apiKey: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export function createOpenAIResponsesProvider(_options: OpenAIResponsesProviderOptions): LLMProvider {
  throw new Error('OpenAI Responses provider is not yet implemented');
}
