// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Gemini Provider
 *
 * Uses the `@google/genai` SDK for Google's Generative AI API.
 * Requires `@google/genai` as an optional peer dependency.
 *
 * @experimental This provider is a skeleton and not yet implemented.
 * Calling `createGeminiProvider()` will throw. Do not use in production.
 */

import type { LLMProvider } from '../types.js';

/**
 * Options for creating a Gemini provider.
 * @experimental
 */
export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

/**
 * Create a Google Gemini provider.
 * @experimental Not yet implemented — throws on invocation.
 */
export function createGeminiProvider(_options: GeminiProviderOptions): LLMProvider {
  throw new Error('Gemini provider is not yet implemented');
}
