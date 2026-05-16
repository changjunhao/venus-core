import { describe, it, expect } from 'bun:test';
import { ProposerAgent } from '../../src/agents/proposer.js';
import { defineProvider } from '../../src/providers/index.js';
import { createMockProvider } from '../helpers/mock-provider.js';
import { PORTRAIT_DIMS, makeDimensions, IMAGE_URL } from '../helpers/mock-data.js';

// ── Portrait 门类维度 ──

function makeProposalJSON(score: number = 7.5) {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: score,
    dimensions: makeDimensions(PORTRAIT_DIMS, score),
    critique: 'Good portrait with nice lighting.',
    suggestions: 'Consider adjusting the background.',
  });
}

describe('ProposerAgent', () => {
  // ── evaluate() 初评流程 ──
  describe('evaluate() — initial evaluation', () => {
    it('should return a valid ProposalResult for portrait genre', async () => {
      const provider = createMockProvider([{ content: makeProposalJSON(8.0), thinking: 'Analyzing portrait...' }]);
      const agent = new ProposerAgent(provider, { model: 'test-model' });

      const { result, thinking } = await agent.evaluate(IMAGE_URL, 'portrait');

      expect(result.scene_type).toBe('studio');
      expect(result.total_score).toBe(8.0);
      expect(Object.keys(result.dimensions)).toHaveLength(5);
      expect(result.critique).toBeTruthy();
      expect(result.suggestions).toBeTruthy();
      expect(thinking).toBe('Analyzing portrait...');
    });

    it('should default to portrait genre when none specified', async () => {
      const provider = createMockProvider([{ content: makeProposalJSON() }]);
      const agent = new ProposerAgent(provider, { model: 'test-model' });

      const { result } = await agent.evaluate(IMAGE_URL);

      expect(result.scene_type).toBe('studio');
      expect(result.total_score).toBe(7.5);
    });
  });

  // ── revise() 修正流程 ──
  describe('revise() — revision after critique', () => {
    it('should return revised ProposalResult incorporating critique feedback', async () => {
      const revisedJSON = makeProposalJSON(7.0);
      const provider = createMockProvider([
        { content: revisedJSON, thinking: 'Revised after considering critique...' },
      ]);
      const agent = new ProposerAgent(provider, { model: 'test-model' });

      const originalProposal = {
        scene_type: 'studio',
        total_score: 8.0,
        dimensions: makeDimensions(PORTRAIT_DIMS, 8.0),
        critique: 'Original assessment.',
        suggestions: 'Original suggestions.',
      };

      const critiqueResult = {
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
            suggested_score: 6.0,
          },
        ],
        severity: 'HIGH' as const,
        overall_assessment: 'Score inflated.',
        suggested_total_score: 7.0,
      };

      const { result, thinking } = await agent.revise(
        IMAGE_URL,
        originalProposal,
        critiqueResult,
        'Critic thinking about issues...',
        'portrait',
      );

      expect(result.total_score).toBe(7.0);
      expect(result.scene_type).toBe('studio');
      expect(thinking).toBe('Revised after considering critique...');
    });

    it('should use revisionConfig when provided', async () => {
      let capturedModel: string | undefined;
      const provider = defineProvider({
        name: 'capture-provider',
        supportsVision: true,
        supportsThinking: true,
        chat: async (params) => {
          capturedModel = params.model;
          return { content: makeProposalJSON(7.0), thinking: null };
        },
      });

      const agent = new ProposerAgent(
        provider,
        { model: 'base-model' },
        { model: 'revision-model', enableThinking: true, thinkingBudget: 2000 },
      );

      await agent.revise(
        IMAGE_URL,
        {
          scene_type: 'studio',
          total_score: 8.0,
          dimensions: makeDimensions(PORTRAIT_DIMS, 8.0),
          critique: 'Original.',
          suggestions: 'Fix.',
        },
        {
          scene_type_review: { proposer_scene: 'studio', is_correct: true, correct_scene: null, reason: 'OK.' },
          challenges: [],
          severity: 'HIGH' as const,
          overall_assessment: 'Needs work.',
          suggested_total_score: 7.0,
        },
        null,
        'portrait',
      );

      expect(capturedModel).toBe('revision-model');
    });
  });
});
