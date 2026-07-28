// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Shared OpenAI SDK Error Classification
 *
 * Maps errors thrown by the OpenAI SDK (shared by the Chat Completions
 * and Responses providers) into standardized ProviderError instances.
 */

import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';

/** Classify an OpenAI SDK error into a ProviderError with a fine-grained error code */
export function classifyOpenAIError(error: unknown, providerName: string): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const oaiError = error as { status?: number; code?: string; cause?: Error & { code?: string } };

  // Also inspect the cause chain (OpenAI SDK wraps fetch errors in APIConnectionError)
  const cause = oaiError.cause;
  const causeCode = cause?.code;
  const causeMessage = cause?.message ?? '';

  let errorCode: ProviderErrorCode = 'unknown';
  if (oaiError.status === 401 || oaiError.status === 403) {
    errorCode = 'auth_error';
  } else if (
    oaiError.code === 'ETIMEDOUT' ||
    oaiError.code === 'ESOCKETTIMEDOUT' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'ESOCKETTIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    causeMessage.includes('timeout') ||
    causeMessage.includes('timed out')
  ) {
    errorCode = 'timeout';
  } else if (
    oaiError.code === 'ECONNREFUSED' ||
    oaiError.code === 'ENOTFOUND' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ENOTFOUND' ||
    message.includes('fetch failed') ||
    causeMessage.includes('fetch failed') ||
    message.includes('Connection error')
  ) {
    errorCode = 'network';
  } else if (oaiError.status && oaiError.status >= 400) {
    errorCode = 'api_error';
  }

  return new ProviderError(`LLM call failed: ${message}`, providerName, errorCode, oaiError.status);
}
