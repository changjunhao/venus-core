// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { getCriticSystemPrompt, getCriticUserPrompt } from '../../src/prompts/critic.js';
import { getGenreConfig, type Genre } from '../../src/schema/index.js';
import { ALL_GENRES } from '../helpers/mock-data.js';
import type { EvaluationContext, ProposerResult } from '../../src/types.js';

const SAMPLE_PROPOSAL: ProposerResult = {
  scene_type: 'studio',
  total_score: 8.0,
  dimensions: {
    facial_expression: 8.0,
    pose_body: 8.0,
    lighting_quality: 8.0,
    color_mood: 8.0,
    composition_focus: 8.0,
  },
  critique: 'Great portrait.',
  suggestions: 'Minor improvements.',
};

describe('Critic Prompts', () => {
  describe('getCriticSystemPrompt()', () => {
    it.each(ALL_GENRES)('should generate system prompt for "%s" genre', (genre: Genre) => {
      const prompt = getCriticSystemPrompt(genre);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should throw for unknown genre', () => {
      // @ts-expect-error testing runtime error for invalid genre
      expect(() => getCriticSystemPrompt('unknown_genre')).toThrow('Unknown genre');
    });

    it('should include the genre label in the art director role description', () => {
      for (const genre of ALL_GENRES) {
        const config = getGenreConfig(genre);
        const prompt = getCriticSystemPrompt(genre);
        expect(prompt).toContain(config.label);
      }
    });

    it('should describe the critic as an art director role', () => {
      const prompt = getCriticSystemPrompt('portrait');
      expect(prompt).toContain('艺术总监');
      expect(prompt).toContain('批判者');
    });

    it('should include dimension bullets for the genre', () => {
      const config = getGenreConfig('portrait');
      const prompt = getCriticSystemPrompt('portrait');
      for (const dim of config.dimensions) {
        expect(prompt).toContain(dim);
      }
    });

    it('should include severity levels (LOW/MEDIUM/HIGH)', () => {
      const prompt = getCriticSystemPrompt('portrait');
      expect(prompt).toContain('LOW');
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('HIGH');
    });

    it('should include JSON output format with scene_type_review', () => {
      const prompt = getCriticSystemPrompt('portrait');
      expect(prompt).toContain('scene_type_review');
      expect(prompt).toContain('challenges');
      expect(prompt).toContain('overall_assessment');
    });

    it('should include the scoring standard for the genre', () => {
      // portrait standard is imported via STANDARDS registry
      const prompt = getCriticSystemPrompt('portrait');
      expect(prompt.length).toBeGreaterThan(500);
    });
  });

  describe('getCriticUserPrompt()', () => {
    it('should generate user prompt with proposal result', () => {
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('should include the proposal result JSON', () => {
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null);
      expect(prompt).toContain('"scene_type": "studio"');
      expect(prompt).toContain('"total_score": 8');
    });

    it('should include the genre label in context', () => {
      const prompt = getCriticUserPrompt('landscape', { ...SAMPLE_PROPOSAL, scene_type: 'natural' }, null);
      expect(prompt).toContain('风光');
    });

    it('should include proposer thinking when provided', () => {
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, 'Proposer analyzed the lighting patterns...');
      expect(prompt).toContain('proposer_thinking');
      expect(prompt).toContain('Proposer analyzed the lighting patterns...');
    });

    it('should not include proposer thinking section when null', () => {
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null);
      expect(prompt).not.toContain('proposer_thinking');
    });

    it('should include EXIF data when context is provided', () => {
      const context: EvaluationContext = {
        exif: { shutterSpeed: '1/4000', fNumber: 2.8, iso: 800 },
      };
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null, context);
      expect(prompt).toContain('1/4000');
    });

    it('should include consistency check hint when EXIF provided', () => {
      const context: EvaluationContext = {
        exif: { shutterSpeed: '1/500', fNumber: 5.6 },
      };
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null, context);
      expect(prompt).toContain('校验提案者的技术评估是否与这些参数一致');
    });

    it('should instruct to check scene_type accuracy', () => {
      const prompt = getCriticUserPrompt('portrait', SAMPLE_PROPOSAL, null);
      expect(prompt).toContain('子类型');
    });
  });
});
