// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 流式完整性对比集成测试
 *
 * 本文件分为两部分：
 *  1. Mock-based 事件结构规则验证（始终运行）
 *  2. 真实 API 一致性验证（opt-in：需同时设置 RUN_INTEGRATION=1 和 DASHSCOPE_API_KEY，
 *     由 describe.skipIf 控制；默认跳过，避免 prepublishOnly 等流程依赖外部 API）
 *
 * 验证目标：
 *  - 流式事件 timestamp 严格非递减
 *  - 每个 agent_call 必有同 agent + 同 round 的 agent_complete 配对
 *  - evaluation_start 为首事件，evaluation_complete 为末事件
 *  - values 模式不包含 reasoning_chunk / result_chunk
 *  - evaluation_complete.data 与 evaluate() 返回结构字段一致
 */

import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../../src/engine.js';
import type { EvaluationStreamEvent, EvaluationResult } from '../../src/types.js';
import { createMockEngine } from '../helpers/mock-engine.js';
import { PORTRAIT_DIMS, makeDimensions } from '../helpers/mock-data.js';

const API_KEY = process.env.DASHSCOPE_API_KEY;
const runIntegration = process.env.RUN_INTEGRATION === '1' && !!API_KEY;

const TEST_IMAGE_URL =
  'https://ifable-test.oss-cn-beijing.aliyuncs.com/uploads/b312d5367770a3fa094ac66cb0e95e43ac06a24116a26e8f95c7e0211d5b9467.jpg?Expires=1778862105&OSSAccessKeyId=TMP.3L1fYK3PcZcjM2BZgQXfcGVNwHUAXvRt23etcRFPEPWbxVuzKZSNvtjaumaNaJAjxvjQNhdfQLqcwPfTzZMn3nrmrWy4vS&Signature=M6oeCIX7HlzBFvn8c7QIDVDFDqM%3D';

const MOCK_IMAGE = 'https://example.com/test-portrait.jpg';

// ─── Mock JSON 构造器 ────────────────────────────────────

function makeProposalJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.5,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
    critique: 'Good portrait with nice lighting and composition.',
    suggestions: 'Consider adjusting the background for better contrast.',
  });
}

function makeCritiqueJSON(severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'): string {
  return JSON.stringify({
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
    severity,
    overall_assessment: 'Solid evaluation with minor adjustments needed.',
    suggested_total_score: 7.0,
  });
}

function makeArbiterJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'Well-executed studio portrait.',
    suggestions: 'Coach subjects for more relaxed expressions.',
    arbitration_notes: 'Adjusted scores after weighing both arguments.',
  });
}

// ─── 事件断言工具 ────────────────────────────────────────

function assertTimestampsMonotonic(events: EvaluationStreamEvent[]): void {
  for (let i = 1; i < events.length; i++) {
    expect(events[i]!.timestamp).toBeGreaterThanOrEqual(events[i - 1]!.timestamp);
  }
}

/** 验证每个 agent_call 都有匹配的 agent_complete（同 agent + 同 round） */
function assertAgentCallCompletePaired(events: EvaluationStreamEvent[]): void {
  const calls = events.filter((e) => e.type === 'agent_call');
  const completes = events.filter((e) => e.type === 'agent_complete');

  // 数量应一致
  expect(calls.length).toBe(completes.length);
  expect(calls.length).toBeGreaterThan(0);

  for (const call of calls) {
    if (call.type !== 'agent_call') continue;
    const matched = completes.find(
      (c) => c.type === 'agent_complete' && c.agent === call.agent && c.round === call.round,
    );
    expect(matched).toBeDefined();
  }
}

// ──────────────────────────────────────────────────────────
// Part 1: Mock-based 事件完整性验证（始终运行）
// ──────────────────────────────────────────────────────────

describe('Mock - Streaming completeness rules', () => {
  it('event timestamps should be monotonically non-decreasing (3-round flow)', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON(), reasoning: 'reasoning-p' }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 'reasoning-c' }],
      arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 'reasoning-a' }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    assertTimestampsMonotonic(events);
  });

  it('event timestamps should be monotonically non-decreasing (4-round flow)', async () => {
    const engine = createMockEngine({
      proposerResponses: [
        { content: makeProposalJSON() },
        { content: makeProposalJSON() }, // revision
      ],
      criticResponses: [{ content: makeCritiqueJSON('HIGH') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    assertTimestampsMonotonic(events);
  });

  it('every agent_call should have a matching agent_complete (3-round flow)', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    assertAgentCallCompletePaired(events);

    // 3 轮：proposer + critic + arbiter
    const calls = events.filter((e) => e.type === 'agent_call');
    expect(calls.length).toBe(3);
  });

  it('every agent_call should have a matching agent_complete (4-round flow with revision)', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }, { content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('HIGH') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    assertAgentCallCompletePaired(events);

    // 4 轮：proposer + critic + proposer-revision + arbiter
    const calls = events.filter((e) => e.type === 'agent_call');
    expect(calls.length).toBe(4);

    const callAgents = calls.map((e) => (e.type === 'agent_call' ? e.agent : ''));
    expect(callAgents).toContain('proposer-revision');
  });

  it('evaluation_start must be the first event (when genre is provided)', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('LOW') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    expect(events[0]!.type).toBe('evaluation_start');
  });

  it('evaluation_complete must be the last event', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('LOW') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    const last = events[events.length - 1]!;
    expect(last.type).toBe('evaluation_complete');
  });

  it('values mode should NOT contain reasoning_chunk or result_chunk', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON(), reasoning: 'reasoning-p' }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 'reasoning-c' }],
      arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 'reasoning-a' }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait', mode: 'values' })) {
      events.push(event);
    }

    const fineGrained = events.filter((e) => e.type === 'reasoning_chunk' || e.type === 'result_chunk');
    expect(fineGrained.length).toBe(0);
  });

  it('default mode (omit mode) should be values and exclude fine-grained events', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('LOW') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    const fineGrained = events.filter((e) => e.type === 'reasoning_chunk' || e.type === 'result_chunk');
    expect(fineGrained.length).toBe(0);
  });

  it('evaluation_complete.data should match evaluate() return structure (same mock inputs)', async () => {
    // Engine A: evaluate()
    const engineA = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON(), reasoning: 't-p' }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 't-c' }],
      arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 't-a' }],
    });
    const evaluateResult = await engineA.evaluate(MOCK_IMAGE, 'portrait');

    // Engine B: evaluateStream()（独立 mock provider，避免响应被消费）
    const engineB = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON(), reasoning: 't-p' }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM'), reasoning: 't-c' }],
      arbiterResponses: [{ content: makeArbiterJSON(), reasoning: 't-a' }],
    });
    const events: EvaluationStreamEvent[] = [];
    for await (const event of engineB.evaluateStream(MOCK_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }
    const completeEvent = events[events.length - 1]!;
    expect(completeEvent.type).toBe('evaluation_complete');
    if (completeEvent.type !== 'evaluation_complete') return;
    const streamResult = completeEvent.data;

    // 关键字段值应一致（基于相同 mock）
    expect(streamResult.imageUrl).toBe(evaluateResult.imageUrl);
    expect(streamResult.genre).toBe(evaluateResult.genre);
    expect(streamResult.sceneType).toBe(evaluateResult.sceneType);
    expect(streamResult.totalScore).toBe(evaluateResult.totalScore);
    expect(streamResult.dimensions).toEqual(evaluateResult.dimensions);
    expect(streamResult.critique).toBe(evaluateResult.critique);
    expect(streamResult.suggestions).toBe(evaluateResult.suggestions);
    expect(streamResult.arbitrationNotes).toBe(evaluateResult.arbitrationNotes);
    expect(streamResult.metadata.rounds).toBe(evaluateResult.metadata.rounds);

    // 顶层字段集合应一致
    const evaluateKeys = Object.keys(evaluateResult).sort();
    const streamKeys = Object.keys(streamResult).sort();
    expect(streamKeys).toEqual(evaluateKeys);

    // process 子结构字段一致
    expect(Object.keys(streamResult.process).sort()).toEqual(Object.keys(evaluateResult.process).sort());
  });
});

// ──────────────────────────────────────────────────────────
// Part 2: 真实 API 一致性验证（需要 DASHSCOPE_API_KEY）
// ──────────────────────────────────────────────────────────

function createRealEngine() {
  return createVenusEngine({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: API_KEY!,
    defaultModel: 'qwen3.6-plus',
    reasoning: {
      effort: 'medium',
      agents: {
        genreDetector: { effort: 'medium', budgetTokens: 2048 },
        proposer: { effort: 'medium', budgetTokens: 2048 },
        critic: { effort: 'medium', budgetTokens: 2048 },
        arbiter: { effort: 'medium', budgetTokens: 2048 },
      },
    },
    timeout: 180_000,
  });
}

describe.skipIf(!runIntegration)('Real API - Streaming completeness', () => {
  it(
    'event timestamps should be monotonically non-decreasing',
    async () => {
      const engine = createRealEngine();
      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE_URL, { mode: 'values' })) {
        events.push(event);
      }

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toEqual([]);

      assertTimestampsMonotonic(events);
    },
    { timeout: 300_000 },
  );

  it(
    'every agent_call should have a matching agent_complete',
    async () => {
      const engine = createRealEngine();
      const events: EvaluationStreamEvent[] = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE_URL, { mode: 'values' })) {
        events.push(event);
      }

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toEqual([]);

      assertAgentCallCompletePaired(events);

      // 末事件必为 evaluation_complete，且其 data 字段集合与 EvaluationResult 一致
      const last = events[events.length - 1]!;
      expect(last.type).toBe('evaluation_complete');
      if (last.type === 'evaluation_complete') {
        const result: EvaluationResult = last.data;
        const keys = Object.keys(result).sort();
        expect(keys).toEqual(
          [
            'imageUrl',
            'genre',
            'sceneType',
            'totalScore',
            'dimensions',
            'critique',
            'suggestions',
            'arbitrationNotes',
            'process',
            'metadata',
          ].sort(),
        );
      }
    },
    { timeout: 300_000 },
  );
});
