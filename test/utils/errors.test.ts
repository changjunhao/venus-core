// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  VenusError,
  ValidationError,
  ProviderError,
  SchemaError,
  TimeoutError,
} from '../../src/utils/errors.js';

describe('Errors — TimeoutError', () => {
  it('should use default message "Evaluation timed out" when constructed without arguments', () => {
    const err = new TimeoutError();
    expect(err.message).toBe('Evaluation timed out');
  });

  it('should use the provided custom message', () => {
    const err = new TimeoutError('Custom timeout after 30s');
    expect(err.message).toBe('Custom timeout after 30s');
  });

  it('should expose code "TIMEOUT_ERROR"', () => {
    const err = new TimeoutError();
    expect(err.code).toBe('TIMEOUT_ERROR');
  });

  it('should set name to "TimeoutError"', () => {
    const err = new TimeoutError();
    expect(err.name).toBe('TimeoutError');
  });

  it('should be an instance of VenusError', () => {
    const err = new TimeoutError();
    expect(err).toBeInstanceOf(VenusError);
  });

  it('should be an instance of Error', () => {
    const err = new TimeoutError();
    expect(err).toBeInstanceOf(Error);
  });

  it('should be an instance of TimeoutError itself', () => {
    const err = new TimeoutError();
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('should be catchable as a generic Error', () => {
    try {
      throw new TimeoutError('boom');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as TimeoutError).code).toBe('TIMEOUT_ERROR');
      expect((e as TimeoutError).name).toBe('TimeoutError');
    }
  });
});

describe('Errors — Base Error Hierarchy (sanity checks)', () => {
  it('VenusError defaults to code "VENUS_ERROR"', () => {
    const err = new VenusError('something');
    expect(err.code).toBe('VENUS_ERROR');
    expect(err.name).toBe('VenusError');
    expect(err).toBeInstanceOf(Error);
  });

  it('ValidationError is a VenusError with code "VALIDATION_ERROR"', () => {
    const err = new ValidationError('bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('ValidationError');
    expect(err).toBeInstanceOf(VenusError);
  });

  it('ProviderError carries provider/errorCode metadata', () => {
    const err = new ProviderError('upstream failed', 'openai', 'timeout', 504);
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.name).toBe('ProviderError');
    expect(err.provider).toBe('openai');
    expect(err.errorCode).toBe('timeout');
    expect(err.statusCode).toBe(504);
    expect(err).toBeInstanceOf(VenusError);
  });

  it('SchemaError defaults to empty issues array', () => {
    const err = new SchemaError('parse failed');
    expect(err.code).toBe('SCHEMA_ERROR');
    expect(err.name).toBe('SchemaError');
    expect(err.issues).toEqual([]);
    expect(err).toBeInstanceOf(VenusError);
  });
});
