// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { getArbiterSystemPrompt, getArbiterUserPrompt } from '../../src/prompts/arbiter.js';
import { getGenreConfig, type Genre } from '../../src/schema/index.js';
import { ALL_GENRES, PORTRAIT_DIMS, makeDimensions } from '../helpers/mock-data.js';
import type { EvaluationContext, ProposerResult, CritiqueResult } from '../../src/types.js';

const SAMPLE_PROPOSAL: ProposerResult = {
  scene_type: 'studio',
  total_score: 7.5,
  dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
  critique: 'Good portrait.',
  suggestions: 'Try different lighting.',
};

const SAMPLE_CRITIQUE: CritiqueResult = {
  scene_type_review: {
    proposer_scene: 'studio',
    is_correct: true,
    correct_scene: null,
    reason: 'Correct classification.',
  },
  challenges: [
    {
      dimension: 'facial_expression',
      issue: 'Expression could be more natural.',
      evidence: 'Slight tension visible.',
      suggested_score: 6.5,
    },
  ],
  severity: 'MEDIUM',
  overall_assessment: 'Generally solid.',
  suggested_total_score: 7.0,
};

const SAMPLE_REVISION: ProposerResult = {
  scene_type: 'studio',
  total_score: 7.0,
  dimensions: makeDimensions(PORTRAIT_DIMS, 7.0),
  critique: 'Revised assessment.',
  suggestions: 'Focus on expressions.',
};

describe('Arbiter Prompts', () => {
  describe('getArbiterSystemPrompt()', () => {
    it.each(ALL_GENRES)('should generate system prompt for "%s" genre', (genre: Genre) => {
      const prompt = getArbiterSystemPrompt(genre);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should throw for unknown genre', () => {
      // @ts-expect-error testing runtime error for invalid genre
      expect(() => getArbiterSystemPrompt('unknown_genre')).toThrow('Unknown genre');
    });

    it('should describe the arbiter as a chief editor role', () => {
      const prompt = getArbiterSystemPrompt('portrait');
      expect(prompt).toContain('终审主编');
      expect(prompt).toContain('仲裁者');
    });

    it('should emphasize independent judgment', () => {
      const prompt = getArbiterSystemPrompt('portrait');
      expect(prompt).toContain('独立判断');
    });

    it('should include the genre label', () => {
      for (const genre of ALL_GENRES) {
        const config = getGenreConfig(genre);
        const prompt = getArbiterSystemPrompt(genre);
        expect(prompt).toContain(config.label);
      }
    });

    it('should include JSON output format with arbitration_notes', () => {
      const prompt = getArbiterSystemPrompt('portrait');
      expect(prompt).toContain('arbitration_notes');
      expect(prompt).toContain('scene_type');
      expect(prompt).toContain('total_score');
    });

    it('should include subtype explanation for scene_type', () => {
      const prompt = getArbiterSystemPrompt('sports');
      expect(prompt).toContain('action');
      expect(prompt).toContain('extreme');
    });

    it('should include the scoring standard for the genre', () => {
      const prompt = getArbiterSystemPrompt('portrait');
      expect(prompt.length).toBeGreaterThan(500);
    });

    it('should mention considering both proposer and critic', () => {
      const prompt = getArbiterSystemPrompt('landscape');
      expect(prompt).toContain('提案者');
      expect(prompt).toContain('批判者');
    });
  });

  describe('getArbiterUserPrompt()', () => {
    it('should generate user prompt with proposal and critique (3-round)', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(20);
    });

    it('should include proposal result JSON', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null);
      expect(prompt).toContain('"total_score": 7.5');
    });

    it('should include critique result JSON', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null);
      expect(prompt).toContain('"severity": "MEDIUM"');
    });

    it('should include revision when provided (4-round flow)', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, SAMPLE_REVISION, null, null);
      expect(prompt).toContain('修正评分');
      expect(prompt).toContain('"total_score": 7');
    });

    it('should include critic reasoning when provided', () => {
      const prompt = getArbiterUserPrompt(
        'portrait',
        SAMPLE_PROPOSAL,
        SAMPLE_CRITIQUE,
        null,
        'Critic reasoning about severity...',
        null,
      );
      expect(prompt).toContain('critic_reasoning');
      expect(prompt).toContain('Critic reasoning about severity...');
    });

    it('should include revision reasoning when provided', () => {
      const prompt = getArbiterUserPrompt(
        'portrait',
        SAMPLE_PROPOSAL,
        SAMPLE_CRITIQUE,
        SAMPLE_REVISION,
        null,
        'Revision reasoning after critique...',
      );
      expect(prompt).toContain('revision_reasoning');
      expect(prompt).toContain('Revision reasoning after critique...');
    });

    it('should include both critic and revision reasoning when both provided', () => {
      const prompt = getArbiterUserPrompt(
        'portrait',
        SAMPLE_PROPOSAL,
        SAMPLE_CRITIQUE,
        SAMPLE_REVISION,
        'Critic reasoning...',
        'Revision reasoning...',
      );
      expect(prompt).toContain('critic_reasoning');
      expect(prompt).toContain('revision_reasoning');
    });

    it('should not include reasoning sections when null', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null);
      expect(prompt).not.toContain('critic_reasoning');
      expect(prompt).not.toContain('revision_reasoning');
    });

    it('should include EXIF context when provided', () => {
      const context: EvaluationContext = {
        exif: { shutterSpeed: '1/1000', fNumber: 4.0 },
      };
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null, context);
      expect(prompt).toContain('1/1000');
    });

    it('should instruct independent scene_type judgment', () => {
      const prompt = getArbiterUserPrompt('portrait', SAMPLE_PROPOSAL, SAMPLE_CRITIQUE, null, null, null);
      expect(prompt).toContain('独立判断');
    });
  });
});
