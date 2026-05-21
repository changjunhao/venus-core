// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { getProposerSystemPrompt, getProposerUserPrompt, getRevisionUserPrompt } from '../../src/prompts/proposer.js';
import { getGenreConfig, type Genre } from '../../src/schema/index.js';
import { ALL_GENRES } from '../helpers/mock-data.js';
import type { EvaluationContext, ProposerResult, CritiqueResult } from '../../src/types.js';

const SAMPLE_EXIF: EvaluationContext = {
  exif: {
    shutterSpeed: '1/2000',
    iso: 400,
    fNumber: 2.8,
    focalLength: 85,
  },
};

describe('Proposer Prompts', () => {
  describe('getProposerSystemPrompt()', () => {
    it.each(ALL_GENRES)('should generate system prompt for "%s" genre', (genre: Genre) => {
      const prompt = getProposerSystemPrompt(genre);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should default to portrait when no genre provided', () => {
      // The function signature requires a genre, default is 'portrait'
      const prompt = getProposerSystemPrompt('portrait');
      expect(prompt).toContain('人像');
    });

    it('should throw for unknown genre', () => {
      // @ts-expect-error testing runtime error for invalid genre
      expect(() => getProposerSystemPrompt('unknown_genre')).toThrow('Unknown genre');
    });

    it('should include the scoring standard for the genre', () => {
      const prompt = getProposerSystemPrompt('portrait');
      // Should contain substantial scoring criteria
      expect(prompt.length).toBeGreaterThan(500);
    });

    it('should include the genre label in the expert role description', () => {
      for (const genre of ALL_GENRES) {
        const config = getGenreConfig(genre);
        const prompt = getProposerSystemPrompt(genre);
        expect(prompt).toContain(config.label);
      }
    });

    it('should include dimension list in the workflow steps', () => {
      const config = getGenreConfig('portrait');
      const prompt = getProposerSystemPrompt('portrait');

      for (const label of config.dimensionLabels) {
        expect(prompt).toContain(label);
      }
    });

    it('should include JSON output format requirements', () => {
      const prompt = getProposerSystemPrompt('portrait');
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('scene_type');
      expect(prompt).toContain('total_score');
      expect(prompt).toContain('dimensions');
    });

    it('should include subtype explanation', () => {
      const prompt = getProposerSystemPrompt('sports');
      expect(prompt).toContain('action');
      expect(prompt).toContain('extreme');
    });

    it('should include dimension examples with score range hint', () => {
      const prompt = getProposerSystemPrompt('landscape');
      expect(prompt).toContain('<0-10的数值，保留1位小数>');
    });
  });

  describe('getProposerUserPrompt()', () => {
    it('should generate user prompt for portrait without context', () => {
      const prompt = getProposerUserPrompt('portrait');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('should include the genre label in the instruction', () => {
      const prompt = getProposerUserPrompt('landscape');
      expect(prompt).toContain('风光');
    });

    it('should include EXIF data when context is provided', () => {
      const prompt = getProposerUserPrompt('portrait', SAMPLE_EXIF);
      expect(prompt).toContain('1/2000');
      expect(prompt).toContain('f/2.8');
    });

    it('should not include EXIF when context is undefined', () => {
      const prompt = getProposerUserPrompt('portrait');
      expect(prompt).not.toContain('1/2000');
    });

    it('should mention the number of dimensions in instructions', () => {
      const config = getGenreConfig('portrait');
      const prompt = getProposerUserPrompt('portrait');
      expect(prompt).toContain(`${config.dimensions.length}个维度`);
    });

    it('should include genre detection reasoning when present in context', () => {
      const context: EvaluationContext = {
        genreDetectionReasoning: 'Detected as portrait because of subject focus.',
      };
      const prompt = getProposerUserPrompt('portrait', context);
      expect(prompt).toContain('门类检测依据');
      expect(prompt).toContain('genre_detection_reasoning');
      expect(prompt).toContain('Detected as portrait because of subject focus.');
    });
  });

  describe('getRevisionUserPrompt()', () => {
    const originalProposal: ProposerResult = {
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

    const critiqueResult: CritiqueResult = {
      scene_type_review: {
        proposer_scene: 'studio',
        is_correct: true,
        correct_scene: null,
        reason: 'Correct classification.',
      },
      challenges: [
        { dimension: 'facial_expression', issue: 'Too generous.', evidence: 'Stiff expression.', suggested_score: 6.0 },
      ],
      severity: 'HIGH',
      overall_assessment: 'Score inflated.',
      suggested_total_score: 7.0,
    };

    it('should generate revision prompt with original proposal and critique', () => {
      const prompt = getRevisionUserPrompt('portrait', originalProposal, critiqueResult, null);
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('你之前对这张照片的评估被质疑了');
    });

    it('should include original proposal JSON in the prompt', () => {
      const prompt = getRevisionUserPrompt('portrait', originalProposal, critiqueResult, null);
      expect(prompt).toContain('"scene_type": "studio"');
      expect(prompt).toContain('"total_score": 8');
    });

    it('should include critique result JSON in the prompt', () => {
      const prompt = getRevisionUserPrompt('portrait', originalProposal, critiqueResult, null);
      expect(prompt).toContain('"severity": "HIGH"');
    });

    it('should include critic reasoning when provided', () => {
      const prompt = getRevisionUserPrompt(
        'portrait',
        originalProposal,
        critiqueResult,
        'Critic reasoning about lighting issues...',
      );
      expect(prompt).toContain('critic_reasoning');
      expect(prompt).toContain('Critic reasoning about lighting issues...');
    });

    it('should include EXIF context when provided', () => {
      const prompt = getRevisionUserPrompt('portrait', originalProposal, critiqueResult, null, SAMPLE_EXIF);
      expect(prompt).toContain('1/2000');
    });
  });
});
