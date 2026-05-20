// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 真实 Provider 集成测试 — 流式与非流式
 *
 * 此测试为 opt-in 模式，需同时设置 RUN_INTEGRATION=1 和 DASHSCOPE_API_KEY 才会运行；
 * 否则整个 describe 块被跳过，以避免 prepublishOnly 等流程依赖外部 API。
 * 验证 evaluateStream(values/updates) 与 evaluate() 在真实 LLM 调用下的
 * 事件粒度与结果结构正确性，不验证具体评分值。
 *
 * 运行：
 *   RUN_INTEGRATION=1 DASHSCOPE_API_KEY=sk-xxx bun test test/integration/real-provider-stream.test.ts
 *   # 或使用 npm script：
 *   DASHSCOPE_API_KEY=sk-xxx bun run test:integration
 */

import { describe, it, expect } from 'bun:test';
import { createVenusEngine } from '../../src/engine.js';
import type { EvaluationStreamEvent, EvaluationResult } from '../../src/types.js';

const API_KEY = process.env.DASHSCOPE_API_KEY;
const runIntegration = process.env.RUN_INTEGRATION === '1' && !!API_KEY;

const TEST_IMAGE_URL =
  'https://ifable-test.oss-cn-beijing.aliyuncs.com/uploads/b312d5367770a3fa094ac66cb0e95e43ac06a24116a26e8f95c7e0211d5b9467.jpg?Expires=1778862105&OSSAccessKeyId=TMP.3L1fYK3PcZcjM2BZgQXfcGVNwHUAXvRt23etcRFPEPWbxVuzKZSNvtjaumaNaJAjxvjQNhdfQLqcwPfTzZMn3nrmrWy4vS&Signature=M6oeCIX7HlzBFvn8c7QIDVDFDqM%3D';

function createTestEngine() {
  return createVenusEngine({
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: API_KEY!,
    defaultModel: 'qwen3.6-plus',
    thinking: {
      enabled: true,
      agents: {
        genreDetector: { budget: 2048 },
        proposer: { budget: 2048 },
        critic: { budget: 2048 },
        arbiter: { budget: 2048 },
      },
    },
    timeout: 180_000,
  });
}

/** 收集一次 evaluateStream 的全部事件 */
async function collectStreamEvents(mode: 'values' | 'updates'): Promise<EvaluationStreamEvent[]> {
  const engine = createTestEngine();
  const events: EvaluationStreamEvent[] = [];
  for await (const event of engine.evaluateStream(TEST_IMAGE_URL, { mode })) {
    events.push(event);
  }
  return events;
}

/** 校验一个 EvaluationResult 的结构是否完整有效 */
function assertEvaluationResultShape(result: EvaluationResult): void {
  // 顶层字段
  expect(typeof result.imageUrl).toBe('string');
  expect(result.imageUrl.length).toBeGreaterThan(0);
  expect(typeof result.genre).toBe('string');
  expect(typeof result.sceneType).toBe('string');
  expect(typeof result.critique).toBe('string');
  expect(typeof result.suggestions).toBe('string');
  expect(typeof result.arbitrationNotes).toBe('string');

  // totalScore 在 0-10 范围
  expect(typeof result.totalScore).toBe('number');
  expect(result.totalScore).toBeGreaterThanOrEqual(0);
  expect(result.totalScore).toBeLessThanOrEqual(10);

  // dimensions 含 5 个维度
  expect(result.dimensions).toBeDefined();
  const dimKeys = Object.keys(result.dimensions);
  expect(dimKeys.length).toBe(5);
  for (const key of dimKeys) {
    const v = result.dimensions[key];
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(10);
  }

  // process 子结构
  expect(result.process).toBeDefined();
  expect(result.process.proposal).toBeDefined();
  expect(result.process.proposal.result).toBeDefined();
  expect(result.process.critique).toBeDefined();
  expect(result.process.critique.result).toBeDefined();
  expect(result.process.arbitration).toBeDefined();
  expect(result.process.arbitration.result).toBeDefined();

  // metadata
  expect(result.metadata).toBeDefined();
  expect(typeof result.metadata.evaluatedAt).toBe('string');
  expect(typeof result.metadata.durationMs).toBe('number');
  expect([3, 4]).toContain(result.metadata.rounds);
}

describe.skipIf(!runIntegration)('Real Provider - Stream Integration', () => {
  it(
    'evaluateStream values mode should emit coarse-grained events only',
    async () => {
      const events = await collectStreamEvents('values');

      // 不应有任何错误事件
      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toEqual([]);

      // values 模式：禁止细粒度事件
      const thinkingChunks = events.filter((e) => e.type === 'thinking_chunk');
      const resultChunks = events.filter((e) => e.type === 'result_chunk');
      expect(thinkingChunks.length).toBe(0);
      expect(resultChunks.length).toBe(0);

      // 必须包含粗粒度事件
      const types = new Set(events.map((e) => e.type));
      expect(types.has('evaluation_start')).toBe(true);
      expect(types.has('genre_detected')).toBe(true);
      expect(types.has('agent_call')).toBe(true);
      expect(types.has('agent_complete')).toBe(true);
      expect(types.has('evaluation_complete')).toBe(true);

      // evaluation_complete 应位于事件流末尾
      const last = events[events.length - 1];
      // @ts-expect-error - last element type narrowing not inferred from union array
      expect(last.type).toBe('evaluation_complete');
    },
    { timeout: 300_000 },
  );

  it(
    'evaluateStream updates mode should emit fine-grained events',
    async () => {
      const events = await collectStreamEvents('updates');

      // 不应有任何错误事件
      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toEqual([]);

      // updates 模式：必须含至少一个细粒度事件（thinking_chunk 或 result_chunk）
      const thinkingChunks = events.filter((e) => e.type === 'thinking_chunk');
      const resultChunks = events.filter((e) => e.type === 'result_chunk');
      expect(thinkingChunks.length + resultChunks.length).toBeGreaterThan(0);

      // 同时必须保留所有粗粒度事件
      const types = new Set(events.map((e) => e.type));
      expect(types.has('evaluation_start')).toBe(true);
      expect(types.has('genre_detected')).toBe(true);
      expect(types.has('agent_call')).toBe(true);
      expect(types.has('agent_complete')).toBe(true);
      expect(types.has('evaluation_complete')).toBe(true);

      // 校验细粒度事件字段类型
      for (const ev of thinkingChunks) {
        if (ev.type === 'thinking_chunk') {
          expect(typeof ev.agent).toBe('string');
          expect(typeof ev.content).toBe('string');
        }
      }
      for (const ev of resultChunks) {
        if (ev.type === 'result_chunk') {
          expect(typeof ev.agent).toBe('string');
          expect(typeof ev.partial).toBe('object');
          expect(ev.partial).not.toBeNull();
        }
      }
    },
    { timeout: 300_000 },
  );

  it(
    'evaluate() should return complete EvaluationResult structure',
    async () => {
      const engine = createTestEngine();
      const result = await engine.evaluate(TEST_IMAGE_URL);
      assertEvaluationResultShape(result);
    },
    { timeout: 300_000 },
  );

  it(
    'values mode final result should match evaluate() structure',
    async () => {
      // 通过 evaluateStream(values) 取得 evaluation_complete 事件中的最终结果
      const events = await collectStreamEvents('values');
      const completeEvent = events.find((e) => e.type === 'evaluation_complete');
      expect(completeEvent).toBeDefined();

      if (completeEvent && completeEvent.type === 'evaluation_complete') {
        // 流式最终事件 data 必须满足 EvaluationResult 完整结构
        assertEvaluationResultShape(completeEvent.data);

        // 关键字段集合应与 evaluate() 一致（结构对齐，不比较具体值）
        const streamKeys = Object.keys(completeEvent.data).sort();
        expect(streamKeys).toEqual(
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
