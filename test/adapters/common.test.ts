// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { evaluateRequestSchema, mapErrorToResponse } from '../../src/adapters/common.js';
import { VenusError, ValidationError, ProviderError } from '../../src/utils/errors.js';

describe('Adapter Common', () => {
  describe('evaluateRequestSchema', () => {
    it('should validate a valid request with imageUrl only', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'https://example.com/photo.jpg',
      });
      expect(result.success).toBe(true);
    });

    it('should validate a request with imageUrl and genre', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing imageUrl', () => {
      const result = evaluateRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid imageUrl (not a URL)', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'not-a-valid-url',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid genre', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'invalid_genre',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all 8 valid genres', () => {
      const validGenres = [
        'portrait',
        'landscape',
        'documentary',
        'fine_art',
        'commercial',
        'architecture',
        'nature',
        'sports',
      ];
      for (const genre of validGenres) {
        const result = evaluateRequestSchema.safeParse({
          imageUrl: 'https://example.com/photo.jpg',
          genre,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept request with context', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'https://example.com/photo.jpg',
        context: {
          exif: { shutterSpeed: '1/500', iso: 100 },
          userNotes: 'Test notes',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject context with userNotes exceeding 2000 chars', () => {
      const result = evaluateRequestSchema.safeParse({
        imageUrl: 'https://example.com/photo.jpg',
        context: {
          userNotes: 'A'.repeat(2001),
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('mapErrorToResponse()', () => {
    it('should map ValidationError to 400', () => {
      const { status, body } = mapErrorToResponse(new ValidationError('Invalid input'));
      expect(status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Invalid input');
    });

    it('should map VenusError to 422', () => {
      const { status, body } = mapErrorToResponse(new VenusError('Processing failed', 'PROCESSING_ERROR'));
      expect(status).toBe(422);
      expect(body.error.code).toBe('PROCESSING_ERROR');
      expect(body.error.message).toBe('Processing failed');
    });

    it('should map generic Error to 500', () => {
      const { status, body } = mapErrorToResponse(new Error('Something went wrong'));
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Something went wrong');
    });

    it('should map non-Error throws to 500 with default message', () => {
      const { status, body } = mapErrorToResponse('raw string error');
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Internal server error');
    });

    it('should map null/undefined to 500 with default message', () => {
      const { status, body } = mapErrorToResponse(null);
      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Internal server error');
    });

    it('should map VenusError subclass to 422', () => {
      const { status, body } = mapErrorToResponse(new ProviderError('API failed', 'test', 'api_error', 500));
      expect(status).toBe(422);
      expect(body.error.code).toBe('PROVIDER_ERROR');
    });

    it('should prefer ValidationError (400) over VenusError (422) - subclass check', () => {
      // ValidationError extends VenusError, so instanceof check order matters
      const { status } = mapErrorToResponse(new ValidationError('Bad input'));
      expect(status).toBe(400);
      // ValidationError should hit the ValidationError branch first
    });
  });
});
