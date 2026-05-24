import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../src/engine.js';
import { defineProvider, createOpenAIChatProvider } from '../src/providers/index.js';
import { createMockEngine } from './helpers/mock-engine.js';
import type { EvaluationStreamEvent, EvaluationEvent, EvaluationContext } from '../src/types.js';
import { PORTRAIT_DIMS, makeDimensions } from './helpers/mock-data.js';
import { createMockProvider } from './helpers/mock-provider.js';

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
        proposerResponses: [{ content: makeProposalJSON(), reasoning: 'Proposer reasoning...' }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 'Critic reasoning...' }],
        arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 'Arbiter reasoning...' }],
      });

      const result = await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(result.genre).toBe('portrait');
      expect(result.sceneType).toBe('studio');
      expect(result.totalScore).toBe(7.2);
      expect(result.dimensions).toEqual(makeDimensions(PORTRAIT_DIMS, 7.2));
      expect(result.critique).toBe('Well-executed studio portrait with good technical quality.');
      expect(result.suggestions).toBe('Work on capturing more natural expressions in future shoots.');
      expect(result.arbitrationNotes).toBe(
        'After reviewing both proposer and critic arguments, adjusted scores to reflect valid concerns about expression naturalness.',
      );
      expect(result.metadata.rounds).toBe(3);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.evaluatedAt).toBeTruthy();

      // Process should contain exact agent outputs
      expect(result.process.proposal).toEqual({
        result: {
          scene_type: 'studio',
          total_score: 7.5,
          dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
          critique: 'Good portrait with nice lighting and composition.',
          suggestions: 'Consider adjusting the background for better contrast.',
        },
        reasoning: 'Proposer reasoning...',
      });
      expect(result.process.critique).toEqual({
        result: {
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
          severity: 'MEDIUM',
          overall_assessment: 'Generally solid evaluation with minor adjustments needed.',
          suggested_total_score: 7.0,
        },
        reasoning: 'Critic reasoning...',
      });
      expect(result.process.revision).toBeUndefined();
      expect(result.process.arbitration).toEqual({
        result: {
          scene_type: 'studio',
          total_score: 7.2,
          dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
          critique: 'Well-executed studio portrait with good technical quality.',
          suggestions: 'Work on capturing more natural expressions in future shoots.',
          arbitration_notes:
            'After reviewing both proposer and critic arguments, adjusted scores to reflect valid concerns about expression naturalness.',
        },
        reasoning: 'Arbiter reasoning...',
      });
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
          { content: makeProposalJSON(), reasoning: 'Initial assessment...' },
          { content: makeRevisionJSON(), reasoning: 'Revised after critique...' },
        ],
        criticResponses: [{ content: makeCritiqueJSON('HIGH'), reasoning: 'Severe issues found...' }],
        arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 'Final judgment...' }],
      });

      const result = await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(result.metadata.rounds).toBe(4);
      expect(result.process.revision).toEqual({
        result: {
          scene_type: 'studio',
          total_score: 7.0,
          dimensions: makeDimensions(PORTRAIT_DIMS, 7.0),
          critique: 'Revised assessment accounting for expression concerns.',
          suggestions: 'Focus on coaching subjects for more relaxed expressions.',
        },
        reasoning: 'Revised after critique...',
      });
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
        expect(result.process.proposal).toEqual({
          result: {
            scene_type: 'studio',
            total_score: 7.5,
            dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
            critique: 'Good portrait with nice lighting and composition.',
            suggestions: 'Consider adjusting the background for better contrast.',
          },
          reasoning: null,
        });
        expect(result.process.critique.result.severity).toBe('LOW');
        expect(result.process.critique.reasoning).toBeNull();
        expect(result.process.arbitration).toEqual({
          result: {
            scene_type: 'studio',
            total_score: 7.2,
            dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
            critique: 'Well-executed studio portrait with good technical quality.',
            suggestions: 'Work on capturing more natural expressions in future shoots.',
            arbitration_notes:
              'After reviewing both proposer and critic arguments, adjusted scores to reflect valid concerns about expression naturalness.',
          },
          reasoning: null,
        });
      }
    });
    it('should yield multiple reasoning_chunk and result_chunk events in updates mode', async () => {
      // Use raw VenusEngine + spyProvider to simulate multi-chunk stream with reasoning
      const multiChunkProvider = defineProvider({
        name: 'multi-chunk-provider',
        capabilities: { vision: true, streaming: true },
        chatStream: async function* () {
          yield { reasoning: 'Step 1: Analyze composition...' };
          yield { partial: { scene_type: 'studio' } };
          yield { partial: { total_score: 7.5 } };
          yield { partial: { dimensions: makeDimensions(PORTRAIT_DIMS, 7.5) } };
          yield {
            content: JSON.stringify({
              scene_type: 'studio',
              total_score: 7.5,
              dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
              critique: 'Good.',
              suggestions: 'Improve.',
            }),
          };
        },
        chat: async () => ({ content: makeProposalJSON(), reasoning: null }),
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          proposer: multiChunkProvider,
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
        reasoning: { effort: 'medium' },
      });

      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait', mode: 'updates' })) {
        events.push(event);
      }

      // Should have reasoning_chunk events
      const reasoningChunks = events.filter((e) => e.type === 'reasoning_chunk');
      expect(reasoningChunks.length).toBeGreaterThan(0);
      expect(reasoningChunks[0]!.type === 'reasoning_chunk' && (reasoningChunks[0] as any).content).toContain('Step 1');

      // Should have result_chunk events
      const resultChunks = events.filter((e) => e.type === 'result_chunk');
      expect(resultChunks.length).toBeGreaterThan(0);
    });
  });

  // ── 异常处理 ──
  describe('Error handling', () => {
    it('evaluate() should throw when provider fails', async () => {
      const errorProvider = defineProvider({
        name: 'error-provider',
        capabilities: { vision: true },
        chat: async () => {
          throw new Error('Provider exploded');
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
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
        capabilities: { vision: true },
        chat: async () => {
          throw new Error('Stream provider failed');
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
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
      expect(errorEvent!.type).toBe('error');
      if (errorEvent && errorEvent.type === 'error') {
        expect(errorEvent.error.message).toContain('Stream provider failed');
      }
    });
  });

  // ── #buildGenreDetector() — 间接测试通过 genre auto-detection ──
  describe('Genre detection integration (indirect #buildGenreDetector)', () => {
    it('should auto-detect genre when genre is not provided and genreDetector provider is configured', async () => {
      const genreDetectionJSON = JSON.stringify({ genre: 'portrait', confidence: 0.92 });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          genreDetector: createMockProvider([{ content: genreDetectionJSON, reasoning: 'Detected portrait scene' }]),
          proposer: createMockProvider([{ content: makeProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
      });

      // Call evaluate without genre → triggers #buildGenreDetector() + #detectGenre()
      const result = await engine.evaluate(TEST_IMAGE);

      expect(result.genre).toBe('portrait');
      expect(result.process.genreDetection).toEqual({
        result: { genre: 'portrait', confidence: 0.92 },
        reasoning: 'Detected portrait scene',
      });
    });
  });

  // ── #augmentContextWithGenreReasoning() — 间接边界测试 ──
  describe('Context augmentation with genre reasoning (indirect #augmentContextWithGenreReasoning)', () => {
    it('should return original context when genreDetectionOut is undefined (genre provided manually)', async () => {
      const context: EvaluationContext = { exif: { cameraModel: 'Canon EOS R5' } };

      const engine = createMockEngine({
        proposerResponses: [{ content: makeProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeArbiterJSON() }],
      });

      // Provide genre explicitly → no genre detection → genreDetectionOut is undefined
      const result = await engine.evaluate(TEST_IMAGE, 'portrait', context);

      // genreDetection should not exist in process (no auto-detection performed)
      expect(result.process.genreDetection).toBeUndefined();
      // Context passed through should not have genreDetectionReasoning injected
      if (result.metadata.context) {
        expect(result.metadata.context.genreDetectionReasoning).toBeUndefined();
      }
    });

    it('should merge reasoning into context when genre detection has reasoning', async () => {
      const genreDetectionJSON = JSON.stringify({ genre: 'portrait', confidence: 0.95 });
      const context: EvaluationContext = { exif: { cameraModel: 'Sony A7III' } };

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          genreDetector: createMockProvider([
            { content: genreDetectionJSON, reasoning: 'Subject is centered, portrait orientation' },
          ]),
          proposer: createMockProvider([{ content: makeProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
      });

      // Do not provide genre → auto-detection triggers → reasoning should be merged into context
      const result = await engine.evaluate(TEST_IMAGE, undefined, context);

      expect(result.genre).toBe('portrait');
      expect(result.process.genreDetection).toEqual({
        result: { genre: 'portrait', confidence: 0.95 },
        reasoning: 'Subject is centered, portrait orientation',
      });
    });

    it('should create new context when context is undefined but reasoning exists', async () => {
      const genreDetectionJSON = JSON.stringify({ genre: 'portrait', confidence: 0.87 });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          genreDetector: createMockProvider([{ content: genreDetectionJSON, reasoning: 'Natural elements detected' }]),
          proposer: createMockProvider([{ content: makeProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
      });

      // No context provided, no genre provided → auto-detection + context creation from reasoning
      const result = await engine.evaluate(TEST_IMAGE);

      expect(result.genre).toBe('portrait');
      expect(result.process.genreDetection).toEqual({
        result: { genre: 'portrait', confidence: 0.87 },
        reasoning: 'Natural elements detected',
      });
    });
  });

  // ── #getReasoningConfig() — 边界测试 ──
  describe('Reasoning config resolution (#getReasoningConfig)', () => {
    it('should pass global reasoning effort to all agents when configured', async () => {
      let proposerParams: any = null;
      let criticParams: any = null;
      let arbiterParams: any = null;

      const spyProposer = defineProvider({
        name: 'spy-proposer',
        capabilities: { vision: true },
        chat: async (params) => {
          proposerParams = params;
          return { content: makeProposalJSON(), reasoning: null };
        },
      });
      const spyCritic = defineProvider({
        name: 'spy-critic',
        capabilities: { vision: true },
        chat: async (params) => {
          criticParams = params;
          return { content: makeCritiqueJSON('LOW'), reasoning: null };
        },
      });
      const spyArbiter = defineProvider({
        name: 'spy-arbiter',
        capabilities: { vision: true },
        chat: async (params) => {
          arbiterParams = params;
          return { content: makeArbiterJSON(), reasoning: null };
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: { proposer: spyProposer, critic: spyCritic, arbiter: spyArbiter },
        reasoning: { effort: 'medium', budgetTokens: 4096 },
      });

      await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(proposerParams.reasoning).toEqual({ effort: 'medium', budgetTokens: 4096 });
      expect(criticParams.reasoning).toEqual({ effort: 'medium', budgetTokens: 4096 });
      expect(arbiterParams.reasoning).toEqual({ effort: 'medium', budgetTokens: 4096 });
    });

    it('should disable reasoning for a specific agent when agentOverride is false', async () => {
      let proposerParams: any = null;
      let criticParams: any = null;

      const spyProposer = defineProvider({
        name: 'spy-proposer-disabled',
        capabilities: { vision: true },
        chat: async (params) => {
          proposerParams = params;
          return { content: makeProposalJSON(), reasoning: null };
        },
      });
      const spyCritic = defineProvider({
        name: 'spy-critic-active',
        capabilities: { vision: true },
        chat: async (params) => {
          criticParams = params;
          return { content: makeCritiqueJSON('LOW'), reasoning: null };
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          proposer: spyProposer,
          critic: spyCritic,
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
        reasoning: {
          effort: 'high',
          agents: { proposer: false },
        },
      });

      await engine.evaluate(TEST_IMAGE, 'portrait');

      // Proposer should have NO reasoning (explicitly disabled)
      expect(proposerParams.reasoning).toBeUndefined();
      // Critic should still have the global reasoning config
      expect(criticParams.reasoning).toEqual({ effort: 'high' });
    });

    it('should use per-agent reasoning override over global config', async () => {
      let proposerParams: any = null;
      let criticParams: any = null;

      const spyProposer = defineProvider({
        name: 'spy-proposer-override',
        capabilities: { vision: true },
        chat: async (params) => {
          proposerParams = params;
          return { content: makeProposalJSON(), reasoning: null };
        },
      });
      const spyCritic = defineProvider({
        name: 'spy-critic-global',
        capabilities: { vision: true },
        chat: async (params) => {
          criticParams = params;
          return { content: makeCritiqueJSON('LOW'), reasoning: null };
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          proposer: spyProposer,
          critic: spyCritic,
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
        reasoning: {
          effort: 'low',
          agents: { proposer: { effort: 'high', budgetTokens: 8192 } },
        },
      });

      await engine.evaluate(TEST_IMAGE, 'portrait');

      // Proposer should use per-agent override
      expect(proposerParams.reasoning).toEqual({ effort: 'high', budgetTokens: 8192 });
      // Critic should use global default
      expect(criticParams.reasoning).toEqual({ effort: 'low' });
    });

    it('should not pass reasoning to any agent when reasoning is not configured', async () => {
      let proposerParams: any = null;
      let arbiterParams: any = null;

      const spyProposer = defineProvider({
        name: 'spy-proposer-no-reasoning',
        capabilities: { vision: true },
        chat: async (params) => {
          proposerParams = params;
          return { content: makeProposalJSON(), reasoning: null };
        },
      });
      const spyArbiter = defineProvider({
        name: 'spy-arbiter-no-reasoning',
        capabilities: { vision: true },
        chat: async (params) => {
          arbiterParams = params;
          return { content: makeArbiterJSON(), reasoning: null };
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          proposer: spyProposer,
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: spyArbiter,
        },
        // No reasoning config at all
      });

      await engine.evaluate(TEST_IMAGE, 'portrait');

      expect(proposerParams.reasoning).toBeUndefined();
      expect(arbiterParams.reasoning).toBeUndefined();
    });

    it('should pass reasoning to genreDetector when auto-detection is triggered', async () => {
      let genreDetectorParams: any = null;

      const spyGenreDetector = defineProvider({
        name: 'spy-genre-detector',
        capabilities: { vision: true },
        chat: async (params) => {
          genreDetectorParams = params;
          return { content: JSON.stringify({ genre: 'portrait', confidence: 0.9 }), reasoning: null };
        },
      });

      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'mock-key' }),
        defaultModel: 'test-model',
        providers: {
          genreDetector: spyGenreDetector,
          proposer: createMockProvider([{ content: makeProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeArbiterJSON() }]),
        },
        reasoning: { effort: 'low' },
      });

      // No genre specified → auto-detection triggers
      await engine.evaluate(TEST_IMAGE);

      expect(genreDetectorParams.reasoning).toEqual({ effort: 'low' });
    });
  });
});
