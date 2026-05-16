// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Error Definitions
 */

import type { core } from 'zod';

/** Base error class for all Venus errors */
export class VenusError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'VENUS_ERROR') {
    super(message);
    this.name = 'VenusError';
    this.code = code;
  }
}

/** Error thrown when input validation fails */
export class ValidationError extends VenusError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/** Fine-grained error classification for provider failures */
export type ProviderErrorCode = 'network' | 'api_error' | 'parse_error' | 'timeout' | 'auth_error' | 'unknown';

/** Error thrown when an LLM provider call fails */
export class ProviderError extends VenusError {
  public readonly provider: string;
  public readonly errorCode: ProviderErrorCode;
  public readonly statusCode?: number;

  constructor(message: string, provider: string, errorCode: ProviderErrorCode = 'unknown', statusCode?: number) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    this.provider = provider;
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}

/** Error thrown when schema validation/parsing fails */
export class SchemaError extends VenusError {
  public readonly issues: core.$ZodIssue[];

  constructor(message: string, issues: core.$ZodIssue[] = []) {
    super(message, 'SCHEMA_ERROR');
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

/** Error thrown when evaluation times out */
export class TimeoutError extends VenusError {
  constructor(message: string = 'Evaluation timed out') {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}
