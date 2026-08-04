import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../src/engine.js';
import { defineProvider } from '../src/providers/index.js';
import { createMockEngine } from './helpers/mock-engine.js';
import { createMockProvider } from './helpers/mock-provider.js';
import { ValidationError } from '../src/utils/errors.js';
import type {
  ChatParams,
  EvaluationEvent,
  GroupEvaluationStreamEvent,
  GroupJointEvaluationResult,
  GroupCompareEvaluationResult,
} from '../src/types.js';
import { PORTRAIT_DIMS, makeDimensions } from './helpers/mock-data.js';

// ── Mock Response Builders ──

const GROUP_IMAGES = [
  'https://example.com/group-1.jpg',
  'https://example.com/group-2.jpg',
  'https://example.com/group-3.jpg',
];

function makePerImage(count = 3, score = 7.5) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    score,
    comment: `第 ${i + 1} 张照片的简评`,
  }));
}

function makeJointProposalJSON(opts: { score?: number; perImage?: boolean } = {}) {
  const score = opts.score ?? 7.5;
  const base: Record<string, unknown> = {
    scene_type: 'studio',
    total_score: score,
    dimensions: makeDimensions(PORTRAIT_DIMS, score),
    group_analysis: '组照叙事完整，风格高度统一。',
    critique: '整体完成度较高的组照。',
    suggestions: ['可以加强收尾照片的表现力。'],
  };
  if (opts.perImage) base.per_image = makePerImage(3, score);
  return JSON.stringify(base);
}

function makeJointArbiterJSON(opts: { perImage?: boolean } = {}) {
  const base: Record<string, unknown> = {
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    group_analysis: '最终认定该组照叙事完整。',
    critique: '组照整体质量良好。',
    suggestions: ['建议统一后期色调。'],
    arbitration_notes: {
      scene_type_ruling: '场景判定明确。',
      decisions: [],
      final_rationale: '采纳了批判者关于表现力的部分质疑。',
    },
  };
  if (opts.perImage) base.per_image = makePerImage(3, 7.2);
  return JSON.stringify(base);
}

const COMPARE_RANKING = [
  { index: 1, rank: 1, score: 8.0, rationale: '构图与光线最完整。' },
  { index: 0, rank: 2, score: 7.0, rationale: '光线尚可但构图略松。' },
  { index: 2, rank: 3, score: 6.0, rationale: '主体虚焦明显。' },
];

function makeCompareProposalJSON(opts: { perImage?: boolean } = {}) {
  const base: Record<string, unknown> = {
    ranking: COMPARE_RANKING,
    comparison_summary: '第 2 张明显优于其余两张，共性问题是背景杂乱。',
    suggestions: ['统一拍摄机位与曝光参数。'],
  };
  if (opts.perImage) base.per_image = makePerImage(3, 7.0);
  return JSON.stringify(base);
}

function makeCompareArbiterJSON(opts: { perImage?: boolean } = {}) {
  const base: Record<string, unknown> = {
    ranking: COMPARE_RANKING,
    comparison_summary: '维持提案者的排名结论。',
    suggestions: ['最终建议：统一拍摄机位与曝光参数。'],
    arbitration_notes: {
      scene_type_ruling: '场景判定明确。',
      decisions: [],
      final_rationale: '排名依据充分，驳回批判者的排名调整请求。',
    },
  };
  if (opts.perImage) base.per_image = makePerImage(3, 7.0);
  return JSON.stringify(base);
}

function makeCritiqueJSON(severity: string = 'MEDIUM') {
  return JSON.stringify({
    scene_type_review: {
      proposer_scene: 'studio',
      is_correct: true,
      correct_scene: null,
      reason: '子类型判断正确。',
    },
    challenges: [
      {
        dimension: 'lighting_quality',
        issue: '组内光线一致性被高估。',
        evidence: '第 3 张照片明显欠曝。',
        suggested_score: 6.5,
      },
    ],
    severity,
    overall_assessment: '整体评估基本合理，个别维度偏高。',
    suggested_total_score: 7.0,
  });
}

/** Spy provider that captures every ChatParams and answers responses in order */
function createCapturingProvider(
  responses: string[],
  opts: { name?: string; structuredOutput?: 'json_object' | 'json_schema' } = {},
) {
  const captured: ChatParams[] = [];
  let i = 0;
  const provider = defineProvider({
    name: opts.name ?? 'capturing-provider',
    capabilities: {
      vision: true,
      ...(opts.structuredOutput ? { structuredOutput: opts.structuredOutput } : {}),
    },
    chat: async (params) => {
      captured.push(params);
      const content = responses[i++];
      if (content === undefined) throw new Error(`Capturing provider exhausted at call #${i}`);
      return { content, reasoning: null };
    },
  });
  return { provider, captured };
}

const mockDefaultProvider = defineProvider({
  name: 'mock-default',
  chat: async () => ({ content: 'unreachable', reasoning: null }),
});

describe('Engine Layer — Group Evaluation', () => {
  // ── evaluateGroup() joint — 3 轮流程 ──
  describe('evaluateGroup() joint — 3-round flow', () => {
    it('should complete with 3 rounds when severity is MEDIUM', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON(), reasoning: 'Group proposer reasoning...' }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 'Group critic reasoning...' }],
        arbiterResponses: [{ content: makeJointArbiterJSON(), reasoning: 'Group arbiter reasoning...' }],
      });

      const result = (await engine.evaluateGroup(GROUP_IMAGES, 'joint', {
        genre: 'portrait',
      })) as GroupJointEvaluationResult;

      expect(result.mode).toBe('joint');
      expect(result.imageUrls).toEqual(GROUP_IMAGES);
      expect(result.genre).toBe('portrait');
      expect(result.sceneType).toBe('studio');
      expect(result.totalScore).toBe(7.2);
      expect(result.dimensions).toEqual(makeDimensions(PORTRAIT_DIMS, 7.2));
      expect(result.groupAnalysis).toBe('最终认定该组照叙事完整。');
      expect(result.critique).toBe('组照整体质量良好。');
      expect(result.suggestions).toEqual(['建议统一后期色调。']);
      expect(result.arbitrationNotes).toEqual({
        sceneTypeRuling: '场景判定明确。',
        decisions: [],
        finalRationale: '采纳了批判者关于表现力的部分质疑。',
      });

      // metadata
      expect(result.metadata.rounds).toBe(3);
      expect(result.metadata.imageCount).toBe(3);
      expect(result.metadata.includePerImage).toBe(false);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.evaluatedAt).toBeTruthy();

      // process
      expect(result.process.genreDetection).toBeUndefined();
      expect(result.process.proposal).toEqual({
        result: JSON.parse(makeJointProposalJSON()),
        reasoning: 'Group proposer reasoning...',
      });
      expect(result.process.critique.result.severity).toBe('MEDIUM');
      expect(result.process.revision).toBeUndefined();
      expect(result.process.arbitration).toEqual({
        result: JSON.parse(makeJointArbiterJSON()),
        reasoning: 'Group arbiter reasoning...',
      });

      // includePerImage=false（默认）: 结果不含 perImage 键
      expect('perImage' in result).toBe(false);
    });

    it('should complete with 3 rounds when severity is LOW', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
      });

      const result = await engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' });
      expect(result.metadata.rounds).toBe(3);
      expect(result.process.revision).toBeUndefined();
    });
  });

  // ── evaluateGroup() joint — 4 轮流程 (severity HIGH) ──
  describe('evaluateGroup() joint — 4-round flow (severity HIGH)', () => {
    it('should trigger reviseGroup and complete with 4 rounds', async () => {
      const engine = createMockEngine({
        // Proposer is called twice: evaluateGroup + reviseGroup
        proposerResponses: [
          { content: makeJointProposalJSON(), reasoning: 'Initial group assessment...' },
          { content: makeJointProposalJSON({ score: 7.0 }), reasoning: 'Revised after group critique...' },
        ],
        criticResponses: [{ content: makeCritiqueJSON('HIGH') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
      });

      const result = await engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' });

      expect(result.metadata.rounds).toBe(4);
      expect(result.process.revision).toEqual({
        result: JSON.parse(makeJointProposalJSON({ score: 7.0 })),
        reasoning: 'Revised after group critique...',
      });
    });
  });

  // ── evaluateGroup() compare ──
  describe('evaluateGroup() compare', () => {
    it('should map ranking and comparisonSummary from arbitration', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeCompareProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeCompareArbiterJSON() }],
      });

      const result = (await engine.evaluateGroup(GROUP_IMAGES, 'compare', {
        genre: 'portrait',
      })) as GroupCompareEvaluationResult;

      expect(result.mode).toBe('compare');
      expect(result.ranking).toEqual(COMPARE_RANKING);
      expect(result.comparisonSummary).toBe('维持提案者的排名结论。');
      expect(result.suggestions).toEqual(['最终建议：统一拍摄机位与曝光参数。']);
      expect(result.arbitrationNotes).toEqual({
        sceneTypeRuling: '场景判定明确。',
        decisions: [],
        finalRationale: '排名依据充分，驳回批判者的排名调整请求。',
      });
      expect(result.metadata.rounds).toBe(3);
      expect('perImage' in result).toBe(false);
      expect(result.process.proposal.result.ranking).toEqual(COMPARE_RANKING);
    });
  });

  // ── includePerImage 双层控制 ──
  describe('evaluateGroup() — includePerImage', () => {
    it('should not include per_image in json_schema response_format when includePerImage=false (default)', async () => {
      const { provider, captured } = createCapturingProvider(
        [makeJointProposalJSON(), makeCritiqueJSON('LOW'), makeJointArbiterJSON()],
        { structuredOutput: 'json_schema' },
      );

      const engine = createVenusEngine({ provider, defaultModel: 'test-model' });
      const result = await engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' });

      expect('perImage' in result).toBe(false);
      expect(captured).toHaveLength(3);

      // proposer (call 0) and arbiter (call 2) both use group schemas — must NOT contain per_image
      for (const idx of [0, 2]) {
        const format = captured[idx]!.response_format!;
        expect(format.type).toBe('json_schema');
        if (format.type === 'json_schema') {
          expect(JSON.stringify(format.schema)).not.toContain('per_image');
        }
      }
    });

    it('should include per_image in schema and expose perImage in result when includePerImage=true', async () => {
      const { provider, captured } = createCapturingProvider(
        [makeJointProposalJSON({ perImage: true }), makeCritiqueJSON('LOW'), makeJointArbiterJSON({ perImage: true })],
        { structuredOutput: 'json_schema' },
      );

      const engine = createVenusEngine({ provider, defaultModel: 'test-model' });
      const result = (await engine.evaluateGroup(GROUP_IMAGES, 'joint', {
        genre: 'portrait',
        includePerImage: true,
      })) as GroupJointEvaluationResult;

      expect(result.metadata.includePerImage).toBe(true);
      expect(result.perImage).toEqual(makePerImage(3, 7.2));

      // proposer and arbiter schemas must contain per_image
      for (const idx of [0, 2]) {
        const format = captured[idx]!.response_format!;
        expect(format.type).toBe('json_schema');
        if (format.type === 'json_schema') {
          expect(JSON.stringify(format.schema)).toContain('per_image');
        }
      }
    });

    it('should expose perImage for compare mode when includePerImage=true (json_object path)', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeCompareProposalJSON({ perImage: true }) }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeCompareArbiterJSON({ perImage: true }) }],
      });

      const result = (await engine.evaluateGroup(GROUP_IMAGES, 'compare', {
        genre: 'portrait',
        includePerImage: true,
      })) as GroupCompareEvaluationResult;

      expect(result.perImage).toEqual(makePerImage(3, 7.0));
    });
  });

  // ── genre 自动检测（多图消息）──
  describe('evaluateGroup() — genre auto-detection', () => {
    it('should send all group images to the genre detector', async () => {
      const { provider: detectorSpy, captured } = createCapturingProvider([
        JSON.stringify({ genre: 'portrait', confidence: 0.93 }),
      ]);

      const engine = createVenusEngine({
        provider: mockDefaultProvider,
        defaultModel: 'test-model',
        providers: {
          genreDetector: detectorSpy,
          proposer: createMockProvider([{ content: makeJointProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeJointArbiterJSON() }]),
        },
      });

      const result = await engine.evaluateGroup(GROUP_IMAGES, 'joint');

      expect(result.genre).toBe('portrait');
      expect(result.process.genreDetection).toEqual({
        result: { genre: 'portrait', confidence: 0.93 },
        reasoning: null,
      });

      // Detector 收到的 user content 应包含 N 个 image_url part（按输入顺序）
      const userMessage = captured[0]!.messages.find((m) => m.role === 'user')!;
      expect(Array.isArray(userMessage.content)).toBe(true);
      const imageParts = (userMessage.content as Exclude<typeof userMessage.content, string>).filter(
        (p) => p.type === 'image_url',
      );
      expect(imageParts).toHaveLength(3);
      expect(imageParts.map((p) => (p.type === 'image_url' ? p.image_url.url : ''))).toEqual(GROUP_IMAGES);
    });
  });

  // ── 数量边界校验 ──
  describe('Group size validation', () => {
    const ELEVEN_IMAGES = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.jpg`);

    it('evaluateGroup() should throw ValidationError for 1 image', async () => {
      const engine = createMockEngine({ proposerResponses: [], criticResponses: [], arbiterResponses: [] });
      await expect(
        engine.evaluateGroup(['https://example.com/only.jpg'], 'joint', { genre: 'portrait' }),
      ).rejects.toThrow(ValidationError);
    });

    it('evaluateGroup() should throw ValidationError for 11 images', async () => {
      const engine = createMockEngine({ proposerResponses: [], criticResponses: [], arbiterResponses: [] });
      await expect(engine.evaluateGroup(ELEVEN_IMAGES, 'compare', { genre: 'portrait' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('evaluateGroupStream() should yield an error event for out-of-range sizes', async () => {
      const engine = createMockEngine({ proposerResponses: [], criticResponses: [], arbiterResponses: [] });

      for (const imageUrls of [['https://example.com/only.jpg'], ELEVEN_IMAGES]) {
        const events: GroupEvaluationStreamEvent[] = [];
        for await (const event of engine.evaluateGroupStream(imageUrls, 'joint', { genre: 'portrait' })) {
          events.push(event);
        }
        expect(events).toHaveLength(1);
        const errorEvent = events[0]!;
        expect(errorEvent.type).toBe('error');
        if (errorEvent.type === 'error') {
          expect(errorEvent.error.code).toBe('VALIDATION_ERROR');
        }
      }
    });
  });

  // ── evaluateGroupStream() 事件序列 ──
  describe('evaluateGroupStream()', () => {
    it('should yield events in correct order for 3-round joint flow (genre provided)', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
      });

      const events: GroupEvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint', { genre: 'portrait' })) {
        events.push(event);
      }

      // 首个业务事件为 group_evaluation_start
      expect(events[0]!.type).toBe('group_evaluation_start');
      if (events[0]!.type === 'group_evaluation_start') {
        expect(events[0]!.data).toEqual({ imageUrls: GROUP_IMAGES, mode: 'joint', genre: 'portrait' });
      }

      const agentSequence = events
        .filter((e) => e.type === 'agent_call' || e.type === 'agent_complete')
        .map((e) => `${e.type === 'agent_call' ? 'call' : 'complete'}:${(e as any).agent}`);
      expect(agentSequence).toEqual([
        'call:proposer',
        'complete:proposer',
        'call:critic',
        'complete:critic',
        'call:arbiter',
        'complete:arbiter',
      ]);

      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.type).toBe('group_evaluation_complete');
      if (lastEvent.type === 'group_evaluation_complete') {
        expect(lastEvent.data.mode).toBe('joint');
        expect(lastEvent.data.genre).toBe('portrait');
        expect(lastEvent.data.metadata.rounds).toBe(3);
        if (lastEvent.data.mode === 'joint') {
          expect(lastEvent.data.totalScore).toBe(7.2);
        }
      }
    });

    it('should include proposer-revision round for 4-round flow', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON() }, { content: makeJointProposalJSON({ score: 7.0 }) }],
        criticResponses: [{ content: makeCritiqueJSON('HIGH') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
      });

      const events: GroupEvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint', { genre: 'portrait' })) {
        events.push(event);
      }

      const agentCalls = events.filter((e) => e.type === 'agent_call').map((e) => (e as any).agent);
      expect(agentCalls).toEqual(['proposer', 'critic', 'proposer-revision', 'arbiter']);

      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.type).toBe('group_evaluation_complete');
      if (lastEvent.type === 'group_evaluation_complete') {
        expect(lastEvent.data.metadata.rounds).toBe(4);
      }
    });

    it('should yield genre_detected before group_evaluation_start when auto-detecting', async () => {
      const engine = createVenusEngine({
        provider: mockDefaultProvider,
        defaultModel: 'test-model',
        providers: {
          genreDetector: createMockProvider([
            { content: JSON.stringify({ genre: 'portrait', confidence: 0.9 }), reasoning: '组照均为人像' },
          ]),
          proposer: createMockProvider([{ content: makeJointProposalJSON() }]),
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeJointArbiterJSON() }]),
        },
      });

      const events: GroupEvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint')) {
        events.push(event);
      }

      const eventTypes = events.map((e) => e.type);
      const genreDetectedIdx = eventTypes.indexOf('genre_detected');
      const startIdx = eventTypes.indexOf('group_evaluation_start');
      expect(genreDetectedIdx).toBeGreaterThanOrEqual(0);
      expect(startIdx).toBeGreaterThan(genreDetectedIdx);

      const genreDetected = events[genreDetectedIdx]!;
      if (genreDetected.type === 'genre_detected') {
        expect(genreDetected.data).toEqual({ genre: 'portrait', reasoning: '组照均为人像' });
      }

      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.type).toBe('group_evaluation_complete');
      if (lastEvent.type === 'group_evaluation_complete') {
        expect(lastEvent.data.process.genreDetection).toBeDefined();
      }
    });

    it('should yield reasoning_chunk and result_chunk events in updates mode', async () => {
      const multiChunkProvider = defineProvider({
        name: 'group-multi-chunk-provider',
        capabilities: { vision: true, streaming: true },
        chatStream: async function* () {
          yield { reasoning: 'Step 1: 浏览整组照片...' };
          yield { partial: { scene_type: 'studio' } };
          yield { partial: { total_score: 7.5 } };
          yield { content: makeJointProposalJSON() };
        },
        chat: async () => ({ content: makeJointProposalJSON(), reasoning: null }),
      });

      const engine = createVenusEngine({
        provider: mockDefaultProvider,
        defaultModel: 'test-model',
        providers: {
          proposer: multiChunkProvider,
          critic: createMockProvider([{ content: makeCritiqueJSON('LOW') }]),
          arbiter: createMockProvider([{ content: makeJointArbiterJSON() }]),
        },
      });

      const events: GroupEvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint', {
        genre: 'portrait',
        mode: 'updates',
      })) {
        events.push(event);
      }

      const reasoningChunks = events.filter((e) => e.type === 'reasoning_chunk');
      expect(reasoningChunks.length).toBeGreaterThan(0);
      expect((reasoningChunks[0] as any).content).toContain('Step 1');

      const resultChunks = events.filter((e) => e.type === 'result_chunk');
      expect(resultChunks.length).toBeGreaterThan(0);

      expect(events[events.length - 1]!.type).toBe('group_evaluation_complete');
    });

    it('should yield error event when provider fails', async () => {
      const errorProvider = defineProvider({
        name: 'group-error-provider',
        capabilities: { vision: true },
        chat: async () => {
          throw new Error('Group stream provider failed');
        },
      });

      const engine = createVenusEngine({
        provider: errorProvider,
        defaultModel: 'test-model',
      });

      const events: GroupEvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint', { genre: 'portrait' })) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent && errorEvent.type === 'error') {
        expect(errorEvent.error.message).toContain('Group stream provider failed');
      }
    });
  });

  // ── 异常处理（非流式）──
  describe('evaluateGroup() — error handling', () => {
    it('joint should fail fast when the assembled final result violates its schema', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
        onEvent: (event) => {
          if (event.type === 'agent_complete' && event.agent === 'arbiter') {
            // Mutate only after the agent output passed its own schema, proving the final result is validated independently.
            (event.data as any).result.suggestions = 'legacy string suggestion';
          }
        },
      });

      await expect(engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' })).rejects.toThrow();
    });

    it('compare should fail fast when the assembled final result violates its schema', async () => {
      const engine = createMockEngine({
        proposerResponses: [{ content: makeCompareProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('LOW') }],
        arbiterResponses: [{ content: makeCompareArbiterJSON() }],
        onEvent: (event) => {
          if (event.type === 'agent_complete' && event.agent === 'arbiter') {
            // Mutate only after the agent output passed its own schema, proving the final result is validated independently.
            (event.data as any).result.arbitration_notes = 'legacy string arbitration notes';
          }
        },
      });

      await expect(engine.evaluateGroup(GROUP_IMAGES, 'compare', { genre: 'portrait' })).rejects.toThrow();
    });

    it('should emit error event and rethrow when provider fails', async () => {
      const events: EvaluationEvent[] = [];
      const errorProvider = defineProvider({
        name: 'group-error-provider',
        capabilities: { vision: true },
        chat: async () => {
          throw new Error('Group provider exploded');
        },
      });

      const engine = createVenusEngine({
        provider: errorProvider,
        defaultModel: 'test-model',
        onEvent: (event) => events.push(event),
      });

      await expect(engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' })).rejects.toThrow(
        'Group provider exploded',
      );

      const errorEvents = events.filter((e) => e.type === 'error');
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0]!.agent).toBe('engine');
    });
  });

  // ── onEvent 回调 ──
  describe('evaluateGroup() — onEvent callback', () => {
    it('should emit agent_call / agent_complete / round_complete with the same structure as single-image', async () => {
      const events: EvaluationEvent[] = [];

      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON(), reasoning: 'P reasoning' }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
        onEvent: (event) => events.push(event),
      });

      await engine.evaluateGroup(GROUP_IMAGES, 'joint', { genre: 'portrait' });

      const eventTypes = events.map((e) => `${e.type}${e.agent ? ':' + e.agent : ''}`);
      expect(eventTypes).toContain('round_start:engine');
      expect(eventTypes).toContain('agent_call:proposer');
      expect(eventTypes).toContain('agent_complete:proposer');
      expect(eventTypes).toContain('agent_call:critic');
      expect(eventTypes).toContain('agent_complete:critic');
      expect(eventTypes).toContain('agent_call:arbiter');
      expect(eventTypes).toContain('agent_complete:arbiter');
      expect(eventTypes).toContain('round_complete');

      // round_start data 携带组图信息
      const roundStart = events.find((e) => e.type === 'round_start')!;
      expect(roundStart.data).toEqual({ imageUrls: GROUP_IMAGES, mode: 'joint', genre: 'portrait' });

      // agent_complete data 与单图一致：{ result, reasoning }
      const proposerComplete = events.find((e) => e.type === 'agent_complete' && e.agent === 'proposer')!;
      expect(proposerComplete.round).toBe(1);
      expect((proposerComplete.data as any).result).toEqual(JSON.parse(makeJointProposalJSON()));
      expect((proposerComplete.data as any).reasoning).toBe('P reasoning');

      // arbiter 在 3 轮流程中 round=3
      const arbiterComplete = events.find((e) => e.type === 'agent_complete' && e.agent === 'arbiter')!;
      expect(arbiterComplete.round).toBe(3);

      for (const event of events) {
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });

    it('should fire onEvent during streaming group evaluation', async () => {
      const observed: EvaluationEvent[] = [];

      const engine = createMockEngine({
        proposerResponses: [{ content: makeJointProposalJSON() }],
        criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
        arbiterResponses: [{ content: makeJointArbiterJSON() }],
        onEvent: (event) => observed.push(event),
      });

      for await (const _event of engine.evaluateGroupStream(GROUP_IMAGES, 'joint', { genre: 'portrait' })) {
        // consume the stream; observability should come through onEvent as well
      }

      const eventTypes = observed.map((e) => `${e.type}${e.agent ? ':' + e.agent : ''}`);
      expect(eventTypes).toContain('round_start:engine');
      expect(eventTypes).toContain('agent_call:proposer');
      expect(eventTypes).toContain('agent_complete:proposer');
      expect(eventTypes).toContain('agent_call:critic');
      expect(eventTypes).toContain('agent_complete:critic');
      expect(eventTypes).toContain('agent_call:arbiter');
      expect(eventTypes).toContain('agent_complete:arbiter');
      expect(eventTypes).toContain('round_complete');
    });
  });
});
