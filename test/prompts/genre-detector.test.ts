// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { getGenreDetectorSystemPrompt, getGenreDetectorUserPrompt } from '../../src/prompts/genre-detector.js';
import { getAllGenres } from '../../src/schema/index.js';

describe('Genre Detector Prompts', () => {
  const ALL_GENRES = getAllGenres();

  describe('getGenreDetectorSystemPrompt()', () => {
    it('should return a non-empty string', () => {
      const prompt = getGenreDetectorSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(50);
    });

    it('should mention all 8 genres', () => {
      const prompt = getGenreDetectorSystemPrompt();
      for (const genre of ALL_GENRES) {
        expect(prompt).toContain(genre);
      }
    });

    it('should describe the expert role as a photography classifier', () => {
      const prompt = getGenreDetectorSystemPrompt();
      expect(prompt).toContain('摄影作品分类专家');
    });

    it('should include genre count in the prompt', () => {
      const prompt = getGenreDetectorSystemPrompt();
      expect(prompt).toContain(`${ALL_GENRES.length} 个门类`);
    });

    it('should include Chinese descriptions for each genre', () => {
      const prompt = getGenreDetectorSystemPrompt();
      expect(prompt).toContain('portrait（人像）');
      expect(prompt).toContain('landscape（风光）');
      expect(prompt).toContain('sports（体育运动）');
    });

    it('should return the same content on repeated calls (deterministic)', () => {
      const prompt1 = getGenreDetectorSystemPrompt();
      const prompt2 = getGenreDetectorSystemPrompt();
      expect(prompt1).toBe(prompt2);
    });
  });

  describe('getGenreDetectorUserPrompt()', () => {
    it('should return a non-empty string', () => {
      const prompt = getGenreDetectorUserPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('should request JSON output format', () => {
      const prompt = getGenreDetectorUserPrompt();
      expect(prompt).toContain('JSON');
    });

    it('should request genre and confidence fields', () => {
      const prompt = getGenreDetectorUserPrompt();
      expect(prompt).toContain('"genre"');
      expect(prompt).toContain('"confidence"');
    });

    it('should list all genres as possible values', () => {
      const prompt = getGenreDetectorUserPrompt();
      for (const genre of ALL_GENRES) {
        expect(prompt).toContain(genre);
      }
    });

    it('should request confidence in 0-1 range', () => {
      const prompt = getGenreDetectorUserPrompt();
      expect(prompt).toContain('0-1的置信度');
    });

    it('should return the same content on repeated calls (deterministic)', () => {
      const prompt1 = getGenreDetectorUserPrompt();
      const prompt2 = getGenreDetectorUserPrompt();
      expect(prompt1).toBe(prompt2);
    });
  });
});
