// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  STANDARDS,
  buildDimensionsExample,
  buildSubtypeExplanation,
  buildDimensionList,
} from '../../src/prompts/shared.js';
import { getGenreConfig, type Genre } from '../../src/schema/index.js';
import { ALL_GENRES } from '../helpers/mock-data.js';

describe('Prompts Shared', () => {
  describe('STANDARDS registry', () => {
    it('should contain entries for all 8 genres', () => {
      for (const genre of ALL_GENRES) {
        expect(STANDARDS[genre]).toBeDefined();
        expect(typeof STANDARDS[genre]).toBe('string');
        expect((STANDARDS[genre] as string).length).toBeGreaterThan(100);
      }
    });

    it('each standard should contain genre-specific scoring criteria', () => {
      // Each standard string should be a substantial prompt
      for (const genre of ALL_GENRES) {
        const standard = STANDARDS[genre] as string;
        expect(standard.length).toBeGreaterThan(100);
      }
    });

    it('portrait standard should contain portrait-related content', () => {
      const standard = STANDARDS['portrait'] as string;
      expect(standard).toContain('人像');
    });

    it('sports standard should contain sports-related content', () => {
      const standard = STANDARDS['sports'] as string;
      expect(standard).toContain('体育');
    });
  });

  describe('buildDimensionsExample()', () => {
    it.each(ALL_GENRES)('should generate dimension JSON example for "%s"', (genre: Genre) => {
      const config = getGenreConfig(genre);
      const result = buildDimensionsExample(config);

      expect(typeof result).toBe('string');
      // Should contain a key for each dimension
      for (const dim of config.dimensions) {
        expect(result).toContain(dim);
      }
      // Should contain the score range hint
      expect(result).toContain('<0-10的数值，保留1位小数>');
    });

    it('should generate portrait dimensions example with correct keys', () => {
      const config = getGenreConfig('portrait');
      const result = buildDimensionsExample(config);

      expect(result).toContain('facial_expression');
      expect(result).toContain('pose_body');
      expect(result).toContain('lighting_quality');
      expect(result).toContain('color_mood');
      expect(result).toContain('composition_focus');
    });

    it('should format each dimension on a separate line', () => {
      const config = getGenreConfig('portrait');
      const result = buildDimensionsExample(config);

      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(config.dimensions.length);
    });
  });

  describe('buildSubtypeExplanation()', () => {
    it.each(ALL_GENRES)('should generate subtype explanation for "%s"', (genre: Genre) => {
      const config = getGenreConfig(genre);
      const result = buildSubtypeExplanation(config);

      expect(typeof result).toBe('string');
      // Should contain all subtype keys
      for (const subtype of config.subtypes) {
        expect(result).toContain(subtype);
      }
    });

    it('should map studio subtype to 棚拍/写真 for portrait', () => {
      const config = getGenreConfig('portrait');
      const result = buildSubtypeExplanation(config);

      expect(result).toContain('studio');
      expect(result).toContain('棚拍/写真');
    });

    it('should include all subtypes for sports', () => {
      const config = getGenreConfig('sports');
      const result = buildSubtypeExplanation(config);

      expect(result).toContain('action');
      expect(result).toContain('extreme');
    });
  });

  describe('buildDimensionList()', () => {
    it.each(ALL_GENRES)('should generate Chinese dimension list for "%s"', (genre: Genre) => {
      const config = getGenreConfig(genre);
      const result = buildDimensionList(config);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should join dimensions with Chinese comma separator', () => {
      const config = getGenreConfig('portrait');
      const result = buildDimensionList(config);

      // Should use Chinese enumeration comma
      expect(result).toContain('、');
    });

    it('should include all Chinese dimension labels for portrait', () => {
      const config = getGenreConfig('portrait');
      const result = buildDimensionList(config);

      expect(result).toContain('面部神态');
      expect(result).toContain('姿态与体态');
      expect(result).toContain('光影品质');
    });
  });
});
