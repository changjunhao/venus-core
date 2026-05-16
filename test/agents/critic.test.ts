import { describe, it, expect } from 'bun:test';
import { CriticAgent } from '../../src/agents/critic.js';
import { createMockProvider } from '../helpers/mock-provider.js';

// ── Helpers ──

function makeCritiqueJSON(severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') {
  return JSON.stringify({
    scene_type_review: {
      proposer_scene: 'studio',
      is_correct: true,
      correct_scene: null,
      reason: 'Correct classification as studio portrait.',
    },
    challenges: [
      {
        dimension: 'facial_expression',
        issue: 'Expression could be more natural.',
        evidence: 'Slight tension visible in jaw area.',
        suggested_score: 6.5,
      },
    ],
    severity,
    overall_assessment: 'Generally solid evaluation with minor adjustments needed.',
    suggested_total_score: 7.0,
  });
}

const IMAGE_URL = 'https://example.com/portrait.jpg';

const MOCK_PROPOSAL = {
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
  suggestions: 'Minor improvements possible.',
};

describe('CriticAgent', () => {
  // ── attack() 质疑逻辑 ──
  describe('attack() — critique logic', () => {
    it('should return a valid CritiqueResult', async () => {
      const provider = createMockProvider([
        { content: makeCritiqueJSON('MEDIUM'), thinking: 'Analyzing proposal weaknesses...' },
      ]);
      const agent = new CriticAgent(provider, { model: 'test-model' });

      const { result, thinking } = await agent.attack(
        IMAGE_URL,
        MOCK_PROPOSAL,
        'Proposer was thinking about lighting...',
        'portrait',
      );

      expect(result.scene_type_review).toBeDefined();
      expect(result.scene_type_review.proposer_scene).toBe('studio');
      expect(result.scene_type_review.is_correct).toBe(true);
      expect(result.challenges).toHaveLength(1);
      expect(result.challenges[0]!.dimension).toBe('facial_expression');
      expect(result.overall_assessment).toBeTruthy();
      expect(result.suggested_total_score).toBe(7.0);
      expect(thinking).toBe('Analyzing proposal weaknesses...');
    });

    it('should handle null proposer thinking', async () => {
      const provider = createMockProvider([{ content: makeCritiqueJSON('LOW') }]);
      const agent = new CriticAgent(provider, { model: 'test-model' });

      const { result } = await agent.attack(IMAGE_URL, MOCK_PROPOSAL, null, 'portrait');

      expect(result.severity).toBe('LOW');
    });
  });

  // ── severity 判定 ──
  describe('severity levels', () => {
    it('should return LOW severity', async () => {
      const provider = createMockProvider([{ content: makeCritiqueJSON('LOW') }]);
      const agent = new CriticAgent(provider, { model: 'test-model' });

      const { result } = await agent.attack(IMAGE_URL, MOCK_PROPOSAL, null, 'portrait');
      expect(result.severity).toBe('LOW');
    });

    it('should return MEDIUM severity', async () => {
      const provider = createMockProvider([{ content: makeCritiqueJSON('MEDIUM') }]);
      const agent = new CriticAgent(provider, { model: 'test-model' });

      const { result } = await agent.attack(IMAGE_URL, MOCK_PROPOSAL, null, 'portrait');
      expect(result.severity).toBe('MEDIUM');
    });

    it('should return HIGH severity', async () => {
      const provider = createMockProvider([{ content: makeCritiqueJSON('HIGH') }]);
      const agent = new CriticAgent(provider, { model: 'test-model' });

      const { result } = await agent.attack(IMAGE_URL, MOCK_PROPOSAL, null, 'portrait');
      expect(result.severity).toBe('HIGH');
    });
  });
});
