import { describe, it, expect } from 'bun:test';
import { ArbiterAgent } from '../../src/agents/arbiter.js';
import { createMockProvider } from '../helpers/mock-provider.js';
import { PORTRAIT_DIMS, makeDimensions, IMAGE_URL } from '../helpers/mock-data.js';

// ── Helpers ──

function makeArbiterJSON(score: number = 7.2) {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: score,
    dimensions: makeDimensions(PORTRAIT_DIMS, score),
    critique: 'Well-executed studio portrait.',
    suggestions: 'Work on capturing more natural expressions.',
    arbitration_notes: 'After reviewing both sides, adjusted scores to reflect valid concerns.',
  });
}

const MOCK_PROPOSAL = {
  scene_type: 'studio',
  total_score: 8.0,
  dimensions: makeDimensions(PORTRAIT_DIMS, 8.0),
  critique: 'Great portrait.',
  suggestions: 'Minor improvements.',
};

const MOCK_CRITIQUE = {
  scene_type_review: {
    proposer_scene: 'studio',
    is_correct: true,
    correct_scene: null,
    reason: 'Correct.',
  },
  challenges: [
    {
      dimension: 'facial_expression',
      issue: 'Too generous.',
      evidence: 'Expression is stiff.',
      suggested_score: 6.5,
    },
  ],
  severity: 'MEDIUM' as const,
  overall_assessment: 'Needs adjustment.',
  suggested_total_score: 7.0,
};

const MOCK_REVISION = {
  scene_type: 'studio',
  total_score: 7.0,
  dimensions: makeDimensions(PORTRAIT_DIMS, 7.0),
  critique: 'Revised assessment.',
  suggestions: 'Focus on expressions.',
};

describe('ArbiterAgent', () => {
  // ── decide() 仲裁逻辑 ──
  describe('decide() — arbitration logic', () => {
    it('should return a valid ArbiterResult', async () => {
      const provider = createMockProvider([
        { content: makeArbiterJSON(7.2), thinking: 'Weighing both perspectives...' },
      ]);
      const agent = new ArbiterAgent(provider, { model: 'test-model' });

      const { result, thinking } = await agent.decide(
        IMAGE_URL,
        MOCK_PROPOSAL,
        MOCK_CRITIQUE,
        null, // no revision
        'Critic thinking...',
        null,
        'portrait',
      );

      expect(result.scene_type).toBe('studio');
      expect(result.total_score).toBe(7.2);
      expect(Object.keys(result.dimensions)).toHaveLength(5);
      expect(result.critique).toBeTruthy();
      expect(result.suggestions).toBeTruthy();
      expect(result.arbitration_notes).toBeTruthy();
      expect(thinking).toBe('Weighing both perspectives...');
    });

    it('should handle revision result when provided (4-round flow)', async () => {
      const provider = createMockProvider([{ content: makeArbiterJSON(7.1) }]);
      const agent = new ArbiterAgent(provider, { model: 'test-model' });

      const { result } = await agent.decide(
        IMAGE_URL,
        MOCK_PROPOSAL,
        MOCK_CRITIQUE,
        MOCK_REVISION,
        'Critic thinking...',
        'Revision thinking...',
        'portrait',
      );

      expect(result.total_score).toBe(7.1);
      expect(result.arbitration_notes).toBeTruthy();
    });

    it('should handle null thinking from both critic and revision', async () => {
      const provider = createMockProvider([{ content: makeArbiterJSON() }]);
      const agent = new ArbiterAgent(provider, { model: 'test-model' });

      const { result } = await agent.decide(IMAGE_URL, MOCK_PROPOSAL, MOCK_CRITIQUE, null, null, null, 'portrait');

      expect(result.scene_type).toBe('studio');
      expect(result.total_score).toBe(7.2);
    });
  });
});
