import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../src/engine.js';
import { defineProvider } from '../src/providers/index.js';
import { createMockEngine } from './helpers/mock-engine.js';
import type { EvaluationStreamEvent, EvaluationEvent } from '../src/types.js';
import { PORTRAIT_DIMS, makeDimensions } from './helpers/mock-data.js';

// ── Mock Response Builders ──
function makeProposalJSON(opts: { severity?: string; score?: number } = {}) {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: opts.score ?? 7.5,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
    critique: 'Good portrait with nice lighting and composition.',
    suggestions: 'Consider adjusting the background for better contrast.',
  });
}

function makeCritiqueJSON(severity: string = 'MEDIUM') {
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

function makeArbiterJSON() {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'Well-executed studio portrait with good technical quality.',
    suggestions: 'Work on capturing more natural expressions in future shoots.',
    arbitration_notes:
      'After reviewing both proposer and critic arguments, adjusted scores to reflect valid concerns about expression naturalness.',
  });
}

function makeRevisionJSON() {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.0,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.0),
    critique: 'Revised assessment accounting for expression concerns.',
    suggestions: 'Focus on coaching subjects for more relaxed expressions.',
  });
}

const TEST_IMAGE = 'https://example.com/test-portrait.jpg';

describe('Engine Layer', () => {
  // ── evaluate() — 3 轮流程 (severity != HIGH) ──
  describe('evaluate() — 3-round flow (severity MEDIUM)', () => {
    it('should complete with 3 rounds when severity is MEDIUM', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON(), thinking: 'Proposer thinking...' }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), thinking: 'Critic thinking...' }],
        arbiterResponses: [{ content: makeArbiterJSON(), thinking: 'Arbiter thinking...' }],
      });

      const result = await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(result.genre).toBe('portrait');
      expect(result.sceneType).toBe('studio');
      expect(result.totalScore).toBe(7.2);
      expect(result.dimensions).toBeDefined();
      expect(Object.keys(result.dimensions)).toHaveLength(5);
      expect(result.critique).toBeTruthy();
      expect(result.suggestions).toBeTruthy();
      expect(result.arbitrationNotes).toBeTruthy();
      expect(result.metadata.rounds).toBe(3);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.evaluatedAt).toBeTruthy();

      // Process should have no revision
      expect(result.process.proposal).toBeDefined();
      expect(result.process.critique).toBeDefined();
      expect(result.process.revision).toBeUndefined();
      expect(result.process.arbitration).toBeDefined();
    });

    it('should complete with 3 rounds when severity is LOW', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
      });

      const result = await engine.evaluate(TEST_IMAGE, 'portrait');
      expect(result.metadata.rounds).toBe(3);
      expect(result.process.revision).toBeUndefined();
    });
  });

  // ── evaluate() — 4 轮流程 (severity == HIGH) ──
  describe('evaluate() — 4-round flow (severity HIGH)', () => {
    it('should complete with 4 rounds when severity is HIGH', async () => {
      const engine = createMockEngine({
        // Proposer is called twice: evaluate + revise
        proposerResponses: [
          { content: makeProposalJSON(), thinking: 'Initial assessment...' },
          { content: makeRevisionJSON(), thinking: 'Revised after critique...' },
        ],
        criticResponses: [{ content: makeCritiqueJSON('HIGH'), thinking: 'Severe issues found...' }],
        arbiterResponses: [{ content: makeArbiterJSON(), thinking: 'Final judgment...' }],
      });

      const result = await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(result.metadata.rounds).toBe(4);
      expect(result.process.revision).toBeDefined();
      expect(result.process.revision!.result.total_score).toBe(7.0);
      expect(result.process.revision!.thinking).toBe('Revised after critique...');
    });
  });

  // ── evaluate() — onEvent callback ──
  describe('evaluate() — onEvent callback', () => {
    it('should emit events in correct sequence', async () => {
      const events: EvaluationEvent[] = [];

      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
        onEvent: (event) => events.push(event),
      });

      await engine.evaluate(TEST_IMAGE, 'portrait');

      // Verify event types sequence
      const eventTypes = events.map((e) => `${e.type}${e.agent ? ':' + e.agent : ''}`);

      // Expected: round_start:engine -> agent_call:proposer -> agent_complete:proposer -> round_complete
      //           -> agent_call:critic -> agent_complete:critic -> round_complete
      //           -> agent_call:arbiter -> agent_complete:arbiter -> round_complete
      expect(eventTypes).toContain('round_start:engine');
      expect(eventTypes).toContain('agent_call:proposer');
      expect(eventTypes).toContain('agent_complete:proposer');
      expect(eventTypes).toContain('agent_call:critic');
      expect(eventTypes).toContain('agent_complete:critic');
      expect(eventTypes).toContain('agent_call:arbiter');
      expect(eventTypes).toContain('agent_complete:arbiter');

      // Verify all events have timestamps
      for (const event of events) {
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  // ── evaluateStream() — 事件顺序验证 ──
  describe('evaluateStream()', () => {
    it('should yield events in correct order for 3-round flow', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
      });

      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
        events.push(event);
      }

      const eventTypes = events.map((e) => e.type);

      // Expected sequence
      expect(eventTypes[0]).toBe('evaluation_start');

      // Find agent_call/agent_complete pairs
      const agentEvents = events.filter((e) => e.type === 'agent_call' || e.type === 'agent_complete');
      const agentSequence = agentEvents.map((e) => {
        if (e.type === 'agent_call') return `call:${(e as any).agent}`;
        return `complete:${(e as any).agent}`;
      });

      expect(agentSequence).toEqual([
        'call:proposer',
        'complete:proposer',
        'call:critic',
        'complete:critic',
        'call:arbiter',
        'complete:arbiter',
      ]);

      // Last event should be evaluation_complete
      expect(eventTypes[eventTypes.length - 1]).toBe('evaluation_complete');
    });

    it('should include revision events for 4-round flow', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }, { content: makeRevisionJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('HIGH') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
      });

      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
        events.push(event);
      }

      const agentCalls = events.filter((e) => e.type === 'agent_call').map((e) => (e as any).agent);

      // Should include proposer-revision for the revision round
      expect(agentCalls).toContain('proposer');
      expect(agentCalls).toContain('critic');
      expect(agentCalls).toContain('proposer-revision');
      expect(agentCalls).toContain('arbiter');
    });

    it('should have complete EvaluationResult in final event', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
      });

      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
        events.push(event);
      }

      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.type).toBe('evaluation_complete');

      if (lastEvent.type === 'evaluation_complete') {
        const result = (lastEvent as any).data;
        expect(result.genre).toBe('portrait');
        expect(result.totalScore).toBe(7.2);
        expect(result.sceneType).toBe('studio');
        expect(result.metadata.rounds).toBe(3);
        expect(result.process.proposal).toBeDefined();
        expect(result.process.critique).toBeDefined();
        expect(result.process.arbitration).toBeDefined();
      }
    });
  });

  // ── 异常处理 ──
  describe('Error handling', () => {
    it('evaluate() should throw when provider fails', async () => {
      const errorProvider = defineProvider({
        name: 'error-provider',
        supportsVision: true,
        chat: async () => {
          throw new Error('Provider exploded');
        },
      });

      const engine = createVenusEngine({
        baseURL: 'https://mock.test/v1',
        apiKey: 'mock-key',
        providers: {
          proposer: errorProvider,
          critic: errorProvider,
          arbiter: errorProvider,
        },
      });

      await expect(engine.evaluate(TEST_IMAGE, 'portrait')).rejects.toThrow();
    });

    it('evaluateStream() should yield error event when provider fails', async () => {
      const errorProvider = defineProvider({
        name: 'error-provider',
        supportsVision: true,
        chat: async () => {
          throw new Error('Stream provider failed');
        },
      });

      const engine = createVenusEngine({
        baseURL: 'https://mock.test/v1',
        apiKey: 'mock-key',
        providers: {
          proposer: errorProvider,
          critic: errorProvider,
          arbiter: errorProvider,
        },
      });

      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === 'error') {
        expect(errorEvent.error.message).toBeTruthy();
      }
    });
  });
});
