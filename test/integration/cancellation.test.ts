// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 端到端取消集成测试：
 *   真实 VenusEngine + 真实 BaseAgent + 自定义 Provider（尊重 signal）+ Express 服务器 + 真 socket 客户端。
 * 覆盖：客户端在收到部分事件后关闭连接，Engine 停止后续 Agent 调用。
 */

import { describe, it, expect } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import { createVenusEngine } from '../../src/engine.js';
import { defineProvider } from '../../src/providers/index.js';
import { createExpressAdapter } from '../../src/adapters/express.js';
import type { LLMProvider, ChatParams, StreamChunk } from '../../src/types.js';
import { deferred, watchdog } from '../helpers/cancellation.js';
import { PORTRAIT_DIMS, makeDimensions } from '../helpers/mock-data.js';

const IMG = 'https://example.com/photo.jpg';

function proposalJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.5,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
    critique: 'ok',
    suggestions: ['ok'],
  });
}
function critiqueJSON(severity: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return JSON.stringify({
    scene_type_review: { proposer_scene: 'studio', is_correct: true, correct_scene: null, reason: 'ok' },
    challenges:
      severity === 'HIGH' ? [{ dimension: 'facial_expression', issue: 'x', evidence: 'y', suggested_score: 6 }] : [],
    severity,
    overall_assessment: 'ok',
    suggested_total_score: 7,
  });
}
function arbiterJSON(): string {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'ok',
    suggestions: ['ok'],
    arbitration_notes: { scene_type_ruling: 'ok', decisions: [], final_rationale: 'ok' },
  });
}

/** 流式 Provider：先 yield 一个短 chunk，然后挂起等待取消。 */
function streamingProvider(
  name: string,
  sink: { calls: number; signals: AbortSignal[]; release?: () => void },
): LLMProvider {
  return defineProvider({
    name,
    capabilities: { vision: true, reasoning: false, reasoningBudget: false, streaming: true },
    chat: async () => ({ content: '', reasoning: null }),
    chatStream: (params: ChatParams): AsyncIterable<StreamChunk> => ({
      [Symbol.asyncIterator]: () => {
        sink.calls++;
        sink.signals.push(params.signal!);
        const content = name === 'proposer' ? proposalJSON() : name === 'critic' ? critiqueJSON('LOW') : arbiterJSON();
        const release = deferred<void>();
        sink.release = () => release.resolve();
        let yielded = false;
        return {
          async next() {
            if (params.signal?.aborted) throw new DOMException('abort', 'AbortError');
            if (!yielded) {
              // 先 yield 一个初始 chunk 确保引擎已进入本
              yielded = true;
              await release.promise;
              if (params.signal?.aborted) throw new DOMException('abort', 'AbortError');
              return { done: false, value: { content } };
            }
            return { done: true, value: undefined };
          },
        };
      },
    }),
  });
}

async function listen(
  engine: ReturnType<typeof createVenusEngine>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/', createExpressAdapter(engine));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

describe('端到端取消集成', () => {
  it('客户端 reader.cancel 后 Engine 不再启动后续 Agent', async () => {
    const cancelled = deferred();
    const proposerSink: { calls: number; signals: AbortSignal[]; release?: () => void } = { calls: 0, signals: [] };
    const criticSink: { calls: number; signals: AbortSignal[]; release?: () => void } = { calls: 0, signals: [] };
    const arbiterSink: { calls: number; signals: AbortSignal[]; release?: () => void } = { calls: 0, signals: [] };
    const engine = createVenusEngine({
      provider: streamingProvider('default', { calls: 0, signals: [] }),
      defaultModel: 'm',
      maxRetries: 1,
      providers: {
        proposer: streamingProvider('proposer', proposerSink),
        critic: streamingProvider('critic', criticSink),
        arbiter: streamingProvider('arbiter', arbiterSink),
      },
      onEvent: (event) => {
        if (event.type === 'cancelled') cancelled.resolve();
      },
    });
    const { url, close } = await listen(engine);
    try {
      const res = await fetch(`${url}/evaluate/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: IMG, genre: 'portrait', mode: 'values' }),
      });
      const reader = res.body!.getReader();
      // 读取事件直到 proposer 已启动（agent_call 到达 + provider 已注册）
      const decoder = new TextDecoder();
      const start = Date.now();
      while (proposerSink.calls === 0 && Date.now() - start < 1500) {
        const chunk = await watchdog(reader.read());
        if (chunk.done) break;
        decoder.decode(chunk.value, { stream: true });
      }
      expect(proposerSink.calls).toBe(1);
      // 此时 proposer 挂起在 release，不会自己完成
      await reader.cancel('user disconnect');
      // 等待服务端明确报告取消，不用固定事件循环轮数推测 socket 断连已传播。
      await watchdog(cancelled.promise);
      expect(criticSink.calls).toBe(0);
      expect(arbiterSink.calls).toBe(0);
      expect(proposerSink.signals.every((s) => s.aborted)).toBe(true);
      proposerSink.release?.();
    } finally {
      await close();
    }
  });
});
