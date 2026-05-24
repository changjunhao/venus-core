// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Gemini Provider
 *
 * Uses the `@google/genai` SDK for Google's Generative AI API.
 * Requires `@google/genai` as an optional peer dependency.
 * Currently a skeleton — implementation deferred.
 */

import type { LLMProvider } from '../types.js';

/** Options for creating a Gemini provider */
export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export function createGeminiProvider(_options: GeminiProviderOptions): LLMProvider {
  throw new Error('Gemini provider is not yet implemented');
}
