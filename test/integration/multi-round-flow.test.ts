// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Integration test — Multi-round evaluation flow.
 *
 * 通过 mock 全局 fetch（拦截 OpenAI SDK 底层调用）验证完整的
 * proposer → critic → arbiter 协作流程，包括调用顺序与流式事件序列。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { createVenusEngine } from '../../src/engine.js';
import { mockFetch, restoreFetch, makeOpenAIResponse } from '../helpers/mock-fetch.js';
import { PORTRAIT_DIMS, makeDimensions } from '../helpers/mock-data.js';
import type { EvaluationStreamEvent } from '../../src/types.js';

const TEST_IMAGE = 'https://oss-materials.ifable.cn/DSCF1469.jpeg';

// ── Mock JSON content builders ──
function makeProposalContent(score = 7.5) {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: score,
    dimensions: makeDimensions(PORTRAIT_DIMS, score),
    critique: 'Solid portrait with balanced exposure.',
    suggestions: 'Slightly soften the key light to reduce shadow contrast.',
  });
}

function makeCritiqueContent(severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') {
  return JSON.stringify({
    scene_type_review: {
      proposer_scene: 'studio',
      is_correct: true,
      correct_scene: null,
      reason: 'Studio backdrop and controlled lighting confirm classification.',
    },
    challenges: [
      {
        dimension: 'facial_expression',
        issue: 'Expression appears slightly tense.',
        evidence: 'Subtle jaw tension visible in mid-frame.',
        suggested_score: 7.0,
      },
    ],
    severity,
    overall_assessment: 'Generally accurate evaluation with minor refinements warranted.',
    suggested_total_score: 7.0,
  });
}

function makeArbiterContent() {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'Professional studio portrait with strong technical execution.',
    suggestions: 'Coach for more relaxed expressions in future sessions.',
    arbitration_notes:
      'Adjusted scores after weighing critic concerns about expression naturalness against proposer rationale.',
  });
}

// ── Agent identification by system-prompt fingerprint ──
function detectAgent(systemPrompt: string): 'proposer' | 'critic' | 'arbiter' | 'unknown' {
  if (systemPrompt.includes('Proposer Agent')) return 'proposer';
  if (systemPrompt.includes('Critic Agent')) return 'critic';
  if (systemPrompt.includes('Arbiter Agent')) return 'arbiter';
  return 'unknown';
}

// ── OpenAI ChatCompletion (non-stream) response builder ──
function makeChatCompletion(content: string) {
  return makeOpenAIResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

// ── OpenAI ChatCompletion stream (SSE) response builder ──
function makeStreamChunks(content: string) {
  const base = {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'test-model',
  };
  return [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
}

function makeSSEResponse(chunks: object[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('Integration — Multi-round evaluation flow (fetch mock)', () => {
  afterEach(() => restoreFetch());

  // ── 3 轮标准流程：调用顺序 ──
  it('should call agents in order: proposer → critic → arbiter (3-round flow)', async () => {
    const callOrder: string[] = [];

    mockFetch(async (_input: any, init: any) => {
      const body = JSON.parse(init.body as string);
      const systemPrompt = String(body.messages[0].content);
      const agent = detectAgent(systemPrompt);
      callOrder.push(agent);

      switch (agent) {
        case 'proposer':
          return makeChatCompletion(makeProposalContent());
        case 'critic':
          return makeChatCompletion(makeCritiqueContent('MEDIUM'));
        case 'arbiter':
          return makeChatCompletion(makeArbiterContent());
        default:
          throw new Error(`Unrecognized agent system prompt: ${systemPrompt.slice(0, 80)}`);
      }
    });

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'test-key',
      maxRetries: 1,
    });

    const result = await engine.evaluate(TEST_IMAGE, 'portrait');

    expect(callOrder).toEqual(['proposer', 'critic', 'arbiter']);
    expect(result.metadata.rounds).toBe(3);
    expect(result.totalScore).toBe(7.2);
    expect(result.sceneType).toBe('studio');
    expect(result.process.proposal).toBeDefined();
    expect(result.process.critique).toBeDefined();
    expect(result.process.revision).toBeUndefined();
    expect(result.process.arbitration).toBeDefined();
  });

  // ── 数据传递验证 ──
  it('should pass each round output forward to subsequent agents', async () => {
    const requestBodies: any[] = [];

    mockFetch(async (_input: any, init: any) => {
      const body = JSON.parse(init.body as string);
      requestBodies.push(body);
      const agent = detectAgent(String(body.messages[0].content));
      switch (agent) {
        case 'proposer':
          return makeChatCompletion(makeProposalContent(7.5));
        case 'critic':
          return makeChatCompletion(makeCritiqueContent('MEDIUM'));
        case 'arbiter':
          return makeChatCompletion(makeArbiterContent());
        default:
          throw new Error('unknown agent');
      }
    });

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'test-key',
      maxRetries: 1,
    });

    await engine.evaluate(TEST_IMAGE, 'portrait');

    expect(requestBodies).toHaveLength(3);

    // critic 的 user prompt 必须包含 proposer 的输出
    const criticUserMessage = JSON.stringify(requestBodies[1].messages[requestBodies[1].messages.length - 1]);
    expect(criticUserMessage).toContain('studio'); // proposer.scene_type
    expect(criticUserMessage).toContain('7.5'); // proposer.total_score

    // arbiter 的 user prompt 必须包含 proposer + critic 的输出
    const arbiterUserMessage = JSON.stringify(requestBodies[2].messages[requestBodies[2].messages.length - 1]);
    expect(arbiterUserMessage).toContain('studio'); // proposer.scene_type
    expect(arbiterUserMessage).toContain('MEDIUM'); // critic.severity
  });

  // ── evaluateStream 事件序列 ──
  it('evaluateStream should emit evaluation_start → (call+complete) x 3 → evaluation_complete', async () => {
    mockFetch(async (_input: any, init: any) => {
      const body = JSON.parse(init.body as string);
      const agent = detectAgent(String(body.messages[0].content));
      switch (agent) {
        case 'proposer':
          return makeSSEResponse(makeStreamChunks(makeProposalContent()));
        case 'critic':
          return makeSSEResponse(makeStreamChunks(makeCritiqueContent('MEDIUM')));
        case 'arbiter':
          return makeSSEResponse(makeStreamChunks(makeArbiterContent()));
        default:
          throw new Error('unknown agent');
      }
    });

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'test-key',
      maxRetries: 1,
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    // 第一个事件必为 evaluation_start
    expect(events[0]?.type).toBe('evaluation_start');

    // 最后一个事件必为 evaluation_complete
    const last = events[events.length - 1];
    expect(last?.type).toBe('evaluation_complete');

    // agent_call / agent_complete 序列必须按序对应 proposer → critic → arbiter
    const agentSequence = events
      .filter((e) => e.type === 'agent_call' || e.type === 'agent_complete')
      .map((e) => `${e.type}:${(e as any).agent}`);

    expect(agentSequence).toEqual([
      'agent_call:proposer',
      'agent_complete:proposer',
      'agent_call:critic',
      'agent_complete:critic',
      'agent_call:arbiter',
      'agent_complete:arbiter',
    ]);

    // 最终结果应包含完整 EvaluationResult
    if (last?.type === 'evaluation_complete') {
      expect(last.data.genre).toBe('portrait');
      expect(last.data.metadata.rounds).toBe(3);
      expect(last.data.totalScore).toBe(7.2);
    }
  });
});
