// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Shared Streaming Utilities
 *
 * Helpers shared by the provider `chatStream` implementations.
 */

import type { createParser } from 'vectorjson';
import type { StreamChunk } from '../types.js';

/** Feed a text delta to the incremental JSON parser and build the stream chunk */
export function makeContentChunk(parser: ReturnType<typeof createParser>, text: string): StreamChunk {
  parser.feed(text);
  try {
    const partial = parser.getValue();
    if (partial !== undefined) {
      return { content: text, partial: partial as Record<string, unknown> };
    }
    return { content: text };
  } catch {
    return { content: text };
  }
}
