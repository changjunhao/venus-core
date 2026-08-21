// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 真实 DeepSeek Vision 集成测试 — deepseek-v4-flash-vision-exp
 *
 * 此测试为 opt-in 模式，需同时设置 RUN_INTEGRATION=1 和 DEEPSEEK_API_KEY 才会运行；
 * 否则整个 describe 块被跳过，以避免 prepublishOnly 等流程依赖外部 API。
 * 验证 Chat Completions 与 Responses API 两条路径在真实视觉模型调用下的
 * 结果结构正确性（含思考禁用参数兼容性），不验证具体评分值。
 *
 * 运行：
 *   RUN_INTEGRATION=1 DEEPSEEK_API_KEY=sk-xxx bun test test/integration/real-deepseek-vision.test.ts
 *   # 或使用 npm script：
 *   DEEPSEEK_API_KEY=sk-xxx bun run test:integration
 */

import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../../src/engine.js';
import { createOpenAIChatProvider, createOpenAIResponsesProvider } from '../../src/providers/index.js';
import type { EvaluationResult } from '../../src/types.js';

const API_KEY = process.env.DEEPSEEK_API_KEY;
const runIntegration = process.env.RUN_INTEGRATION === '1' && !!API_KEY;

const TEST_IMAGE_URL = 'https://oss-materials.ifable.cn/DSCF1469.jpeg';
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';

/** 校验一个 EvaluationResult 的结构是否完整有效（不验证具体评分值） */
function assertEvaluationResultShape(result: EvaluationResult): void {
  expect(typeof result.imageUrl).toBe('string');
  expect(result.imageUrl.length).toBeGreaterThan(0);
  expect(typeof result.genre).toBe('string');
  expect(typeof result.sceneType).toBe('string');
  expect(typeof result.critique).toBe('string');
  expect(Array.isArray(result.suggestions)).toBe(true);
  expect(typeof result.arbitrationNotes).toBe('object');
  expect(typeof result.arbitrationNotes.sceneTypeRuling).toBe('string');
  expect(Array.isArray(result.arbitrationNotes.decisions)).toBe(true);
  expect(typeof result.arbitrationNotes.finalRationale).toBe('string');

  expect(typeof result.totalScore).toBe('number');
  expect(result.totalScore).toBeGreaterThanOrEqual(0);
  expect(result.totalScore).toBeLessThanOrEqual(10);

  expect(result.dimensions).toBeDefined();
  const dimKeys = Object.keys(result.dimensions);
  expect(dimKeys.length).toBe(5);
  for (const key of dimKeys) {
    const v = result.dimensions[key];
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(10);
  }

  expect(result.process).toBeDefined();
  expect(result.process.proposal.result).toBeDefined();
  expect(result.process.critique.result).toBeDefined();
  expect(result.process.arbitration.result).toBeDefined();

  expect(result.metadata).toBeDefined();
  expect(typeof result.metadata.evaluatedAt).toBe('string');
  expect(typeof result.metadata.durationMs).toBe('number');
  expect([3, 4]).toContain(result.metadata.rounds);
}

describe.skipIf(!runIntegration)('Real DeepSeek Vision Integration', () => {
  it(
    'Chat Completions path: evaluate() completes with thinking disabled + json_object',
    async () => {
      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({
          baseURL: 'https://api.deepseek.com',
          apiKey: API_KEY!,
        }),
        defaultModel: VISION_MODEL,
        // No reasoning config — exercises the explicit thinking disable path
      });

      const result = await engine.evaluate(TEST_IMAGE_URL);
      assertEvaluationResultShape(result);
    },
    { timeout: 600_000 },
  );

  it(
    'Responses API path: evaluate() completes with reasoning.effort none + json_object degradation',
    async () => {
      const engine = createVenusEngine({
        provider: createOpenAIResponsesProvider({
          baseURL: 'https://api.deepseek.com',
          apiKey: API_KEY!,
        }),
        defaultModel: VISION_MODEL,
      });

      const result = await engine.evaluate(TEST_IMAGE_URL);
      assertEvaluationResultShape(result);
    },
    { timeout: 600_000 },
  );

  it(
    'Chat Completions path: streaming evaluateStream(values) emits no error events',
    async () => {
      const engine = createVenusEngine({
        provider: createOpenAIChatProvider({
          baseURL: 'https://api.deepseek.com',
          apiKey: API_KEY!,
        }),
        defaultModel: VISION_MODEL,
      });

      const events = [];
      for await (const event of engine.evaluateStream(TEST_IMAGE_URL, { mode: 'values' })) {
        events.push(event);
      }

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toEqual([]);

      const types = new Set(events.map((e) => e.type));
      expect(types.has('evaluation_start')).toBe(true);
      expect(types.has('genre_detected')).toBe(true);
      expect(types.has('evaluation_complete')).toBe(true);

      const last = events[events.length - 1];
      // @ts-expect-error - last element type narrowing not inferred from union array
      expect(last.type).toBe('evaluation_complete');
      // @ts-expect-error - narrowed by assertion above
      assertEvaluationResultShape(last.data);
    },
    { timeout: 600_000 },
  );
});
