// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Integration test — Error recovery and propagation.
 *
 * 通过 mock 全局 fetch 模拟各类故障，验证：
 * 1. 可恢复错误（429 限流）通过重试最终成功
 * 2. 不可恢复错误（401 鉴权失败）正确传播
 * 3. 网络错误（fetch 抛出）被正确包装并传播
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { createVenusEngine } from '../../src/engine.js';
import { VenusError } from '../../src/utils/errors.js';
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
    suggestions: 'Slightly soften the key light.',
  });
}

function makeCritiqueContent(severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') {
  return JSON.stringify({
    scene_type_review: {
      proposer_scene: 'studio',
      is_correct: true,
      correct_scene: null,
      reason: 'Studio backdrop confirms classification.',
    },
    challenges: [
      {
        dimension: 'facial_expression',
        issue: 'Expression appears slightly tense.',
        evidence: 'Subtle jaw tension visible.',
        suggested_score: 7.0,
      },
    ],
    severity,
    overall_assessment: 'Generally accurate evaluation.',
    suggested_total_score: 7.0,
  });
}

function makeArbiterContent() {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'Professional studio portrait.',
    suggestions: 'Coach for more relaxed expressions.',
    arbitration_notes: 'Adjusted scores after weighing critic concerns.',
  });
}

function detectAgent(systemPrompt: string): 'proposer' | 'critic' | 'arbiter' | 'unknown' {
  if (systemPrompt.includes('Proposer Agent')) return 'proposer';
  if (systemPrompt.includes('Critic Agent')) return 'critic';
  if (systemPrompt.includes('Arbiter Agent')) return 'arbiter';
  return 'unknown';
}

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

describe('Integration — Error recovery and propagation', () => {
  afterEach(() => restoreFetch());

  // ── Scenario 1: Provider 重试成功（429 → 200）──
  it('should recover from a transient 429 and complete the evaluation', async () => {
    let proposerFetchCount = 0;

    mockFetch(async (_input: any, init: any) => {
      const body = JSON.parse(init.body as string);
      const agent = detectAgent(String(body.messages[0].content));

      if (agent === 'proposer') {
        proposerFetchCount++;
        // 第 1 次返回 429，第 2 次（重试后）返回成功
        if (proposerFetchCount === 1) {
          return makeOpenAIResponse({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }, 429);
        }
        return makeChatCompletion(makeProposalContent());
      }
      if (agent === 'critic') return makeChatCompletion(makeCritiqueContent('MEDIUM'));
      if (agent === 'arbiter') return makeChatCompletion(makeArbiterContent());
      throw new Error(`Unrecognized agent`);
    });

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'test-key',
      maxRetries: 3,
    });

    const result = await engine.evaluate(TEST_IMAGE, 'portrait');

    // proposer 至少被请求过 2 次（一次失败 + 一次成功）
    expect(proposerFetchCount).toBeGreaterThanOrEqual(2);
    expect(result.metadata.rounds).toBe(3);
    expect(result.totalScore).toBe(7.2);
    expect(result.process.proposal.result.total_score).toBe(7.5);
  });

  // ── Scenario 2: 不可恢复错误传播（401）──
  it('should propagate 401 auth error through evaluate() as VenusError', async () => {
    mockFetch(async () => makeOpenAIResponse({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401));

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'invalid-key',
      maxRetries: 1,
    });

    let caught: unknown;
    try {
      await engine.evaluate(TEST_IMAGE, 'portrait');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(VenusError);
    const ve = caught as VenusError;
    // BaseAgent 在重试耗尽后会包装为 SchemaError，错误链上仍包含原始 401 信息
    expect(ve.code).toBe('SCHEMA_ERROR');
    expect(ve.message).toContain('Invalid API key');
  });

  it('should yield error event in evaluateStream() when 401 occurs', async () => {
    mockFetch(async () => makeOpenAIResponse({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401));

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'invalid-key',
      maxRetries: 1,
    });

    const events: EvaluationStreamEvent[] = [];
    for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait' })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === 'error') {
      expect(errorEvent.error.message).toContain('Invalid API key');
      // 流式路径下 ProviderError 直接传播（BaseAgent.callStream 的 for-await 不在 try/catch 中）
      expect(errorEvent.error.code).toBe('PROVIDER_ERROR');
    }

    // 没有 evaluation_complete 事件（流程未完成）
    expect(events.find((e) => e.type === 'evaluation_complete')).toBeUndefined();
  });

  // ── Scenario 3: 网络错误（fetch reject）──
  it('should propagate network error (TypeError: fetch failed) through evaluate()', async () => {
    mockFetch(async () => {
      const err = new TypeError('fetch failed');
      (err as any).code = 'ECONNREFUSED';
      throw err;
    });

    const engine = createVenusEngine({
      baseURL: 'https://mock-api.test/v1',
      apiKey: 'test-key',
      maxRetries: 1,
    });

    let caught: unknown;
    try {
      await engine.evaluate(TEST_IMAGE, 'portrait');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(VenusError);
    const ve = caught as VenusError;
    // BaseAgent 重试耗尽后包装为 SchemaError；OpenAI SDK 将底层 fetch 故障归一化为 "Connection error."
    expect(ve.code).toBe('SCHEMA_ERROR');
    expect(ve.message.toLowerCase()).toContain('connection error');
  });

  it('should yield error event in evaluateStream() on network failure', async () => {
    mockFetch(async () => {
      const err = new TypeError('fetch failed');
      (err as any).code = 'ECONNREFUSED';
      throw err;
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

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === 'error') {
      // openai-compat 的 chatStream 在网络错误时抛出 ProviderError("Stream call failed: ...")
      expect(errorEvent.error.message.toLowerCase()).toContain('connection error');
      expect(errorEvent.error.code).toBe('PROVIDER_ERROR');
    }
  });
});
