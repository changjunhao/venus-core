// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Provider Types
 *
 * Internal provider types and re-exports.
 */

import type { ChatParams, ChatResponse, ProviderCapabilities, StreamChunk } from '../types.js';

/** Options for the defineProvider factory */
export interface DefineProviderOptions {
  name: string;
  /** Provider feature capabilities */
  capabilities?: Partial<ProviderCapabilities>;
  chat: (params: ChatParams) => Promise<ChatResponse>;
  /** Optional streaming implementation */
  chatStream?: (params: ChatParams) => AsyncIterable<StreamChunk>;
}
