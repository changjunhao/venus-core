// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Shared Provider Error Classification
 *
 * Maps errors thrown by the LLM SDKs (OpenAI, Anthropic, Google GenAI —
 * they all surface `status`, `code` and a wrapped fetch `cause` the same way)
 * into standardized ProviderError instances.
 */

import { ProviderError } from '../utils/errors.js';
import type { ProviderErrorCode } from '../utils/errors.js';

/** Classify an LLM SDK error into a ProviderError with a fine-grained error code */
export function classifyProviderError(error: unknown, providerName: string): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const apiError = error as { status?: number; code?: string; cause?: Error & { code?: string } };

  // Also inspect the cause chain (the SDKs wrap fetch errors in APIConnectionError)
  const cause = apiError.cause;
  const causeCode = cause?.code;
  const causeMessage = cause?.message ?? '';

  let errorCode: ProviderErrorCode = 'unknown';
  if (apiError.status === 401 || apiError.status === 403) {
    errorCode = 'auth_error';
  } else if (
    apiError.code === 'ETIMEDOUT' ||
    apiError.code === 'ESOCKETTIMEDOUT' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'ESOCKETTIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    causeMessage.includes('timeout') ||
    causeMessage.includes('timed out')
  ) {
    errorCode = 'timeout';
  } else if (
    apiError.code === 'ECONNREFUSED' ||
    apiError.code === 'ENOTFOUND' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ENOTFOUND' ||
    message.includes('fetch failed') ||
    causeMessage.includes('fetch failed') ||
    message.includes('Connection error')
  ) {
    errorCode = 'network';
  } else if (apiError.status && apiError.status >= 400) {
    errorCode = 'api_error';
  }

  return new ProviderError(`LLM call failed: ${message}`, providerName, errorCode, apiError.status);
}
