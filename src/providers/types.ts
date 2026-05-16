// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Provider Types
 *
 * Re-exports and internal provider types.
 */

import type { ChatParams, ChatResponse, StreamChunk } from '../types.js';

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
}

/** Options for the defineProvider factory */
export interface DefineProviderOptions {
  name: string;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  chat: (params: ChatParams) => Promise<ChatResponse>;
  /** Optional streaming implementation */
  chatStream?: (params: ChatParams) => AsyncIterable<StreamChunk>;
}
