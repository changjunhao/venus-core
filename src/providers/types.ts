// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Provider Types
 *
 * Re-exports and internal provider types.
 */

import type { ChatParams, ChatResponse, ProviderCapabilities, StreamChunk } from '../types.js';
import type { ProviderStyle } from './reasoning-adapter.js';

/** Options for creating an OpenAI-compatible provider */
export interface OpenAICompatOptions {
  baseURL: string;
  apiKey: string;
  /** Default model identifier */
  defaultModel?: string;
  /** Extra headers to include in requests */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Default vendor-specific extra parameters merged into every request (per-call extra takes priority) */
  defaultExtra?: Record<string, unknown>;
  /**
   * Provider API style for reasoning-parameter adaptation.
   * If omitted, it is auto-detected from `baseURL` via `detectProviderStyle`.
   */
  style?: ProviderStyle;
}

/** Backwards-compatible alias kept for external callers that import the legacy name */
export type OpenAICompatProviderOptions = OpenAICompatOptions;

/** Options for the defineProvider factory */
export interface DefineProviderOptions {
  name: string;
  /** Provider feature capabilities */
  capabilities?: Partial<ProviderCapabilities>;
  chat: (params: ChatParams) => Promise<ChatResponse>;
  /** Optional streaming implementation */
  chatStream?: (params: ChatParams) => AsyncIterable<StreamChunk>;
}
