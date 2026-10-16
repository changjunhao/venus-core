// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 独立进程运行的传输取消验证脚本。
 * 由于跨测试文件的 mock.module('openai') 会全局泄漏，此脚本必须以独立 Bun 进程执行。
 * 退出码：0 = 全部通过；非 0 = 有场景失败。stderr 打印失败详情。
 */

import { createOpenAIChatProvider } from '../src/providers/openai-chat.js';
import { createOpenAIResponsesProvider } from '../src/providers/openai-responses.js';
import { createAnthropicProvider } from '../src/providers/anthropic.js';
import { createGeminiProvider } from '../src/providers/gemini.js';
import { AbortError, ProviderError } from '../src/utils/errors.js';
import type { LLMProvider, ChatParams } from '../src/types.js';

type CapturedInit = { signal?: AbortSignal | null; body?: unknown };
interface Captured {
  signal?: AbortSignal | null;
  abortP: Promise<void>;
  resolveAbort: () => void;
  callP: Promise<void>;
  resolveCall: () => void;
}
function captureHangFetch(): Captured {
  const captured = {} as Captured;
  captured.abortP = new Promise<void>((r) => {
    captured.resolveAbort = r;
  });
  captured.callP = new Promise<void>((r) => {
    captured.resolveCall = r;
  });
  globalThis.fetch = ((input: Request | string | URL, init?: CapturedInit) => {
    captured.signal =
      (input && typeof input === 'object' && 'signal' in input ? (input as Request).signal : undefined) ??
      init?.signal ??
      undefined;
    if (captured.signal?.aborted) captured.resolveAbort();
    else captured.signal?.addEventListener('abort', () => captured.resolveAbort(), { once: true });
    captured.resolveCall();
    return new Promise(() => {});
  }) as unknown as typeof fetch;
  return captured;
}

const providers: Array<[string, () => LLMProvider]> = [
  ['openai-chat', () => createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'k' })],
  ['openai-responses', () => createOpenAIResponsesProvider({ baseURL: 'https://mock.test/v1', apiKey: 'k' })],
  ['anthropic', () => createAnthropicProvider({ apiKey: 'k' })],
  ['gemini', () => createGeminiProvider({ apiKey: 'k' })],
];

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} 超时`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function testChat(label: string, make: () => LLMProvider): Promise<void> {
  const captured = captureHangFetch();
  const provider = make();
  const controller = new AbortController();
  const params: ChatParams = { model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal };
  const pending = provider.chat(params);
  await withTimeout(captured.callP, 1500, `${label} fetch called`);
  controller.abort();
  await withTimeout(captured.abortP, 1500, `${label} fetch abort`);
  if (!captured.signal?.aborted) throw new Error(`${label} chat: 底层 fetch signal 未 aborted`);
  let thrown: unknown;
  try {
    await withTimeout(pending, 1500, `${label} pending reject`);
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof AbortError)) throw new Error(`${label} chat 未抛 AbortError：${String(thrown)}`);
}

async function testStream(label: string, make: () => LLMProvider): Promise<void> {
  const captured = captureHangFetch();
  const provider = make();
  if (!provider.chatStream) throw new Error(`${label} 未实现 chatStream`);
  const iterator = provider
    .chatStream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
    [Symbol.asyncIterator]();
  const next = iterator.next();
  await withTimeout(captured.callP, 1500, `${label} stream fetch called`);
  const returning = iterator.return?.();
  if (!captured.signal?.aborted) throw new Error(`${label} chatStream: return 未同步 abort fetch signal`);
  let thrown: unknown;
  try {
    await withTimeout(next, 1500, `${label} stream next reject`);
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof AbortError)) throw new Error(`${label} chatStream next 未抛 AbortError：${String(thrown)}`);
  await withTimeout(
    Promise.resolve(returning).then(() => undefined),
    1500,
    `${label} return 完成`,
  );
}

async function testPreAbort(): Promise<void> {
  let called = 0;
  globalThis.fetch = (() => {
    called++;
    return Promise.resolve(new Response('{}'));
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  const provider = createOpenAIChatProvider({ baseURL: 'https://mock.test/v1', apiKey: 'k' });
  let thrown: unknown;
  try {
    await provider.chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal });
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof AbortError)) throw new Error(`预取消未抛 AbortError：${String(thrown)}`);
  if (called !== 0) throw new Error(`预取消仍调用了 fetch ${called} 次`);
}

const geminiText = '{"score":8}';
const geminiDelta = `event: step.delta\ndata: ${JSON.stringify({
  event_type: 'step.delta',
  delta: { type: 'text', text: geminiText },
})}\n\n`;

async function testGeminiRecovery(streaming: boolean, failure: 'network' | 'timeout'): Promise<void> {
  const signals: AbortSignal[] = [];
  globalThis.fetch = ((input: Request | string | URL, init?: CapturedInit) => {
    const signal = input instanceof Request ? input.signal : init?.signal;
    if (!signal) throw new Error('Gemini 请求未传入 signal');
    signals.push(signal);
    if (signals.length === 1) {
      if (failure === 'network') return Promise.reject(new TypeError('fetch failed'));
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    return Promise.resolve(
      streaming
        ? new Response(geminiDelta, { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({ id: 'retry-test', status: 'completed', output_text: geminiText }),
    );
  }) as typeof fetch;
  const controller = new AbortController();
  const provider = createGeminiProvider({ apiKey: 'k', timeout: 100 });
  const params: ChatParams = { model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal };
  const consume = async () => {
    if (!streaming) return (await provider.chat(params)).content;
    let content = '';
    for await (const chunk of provider.chatStream!(params)) content += chunk.content ?? '';
    return content;
  };
  try {
    const content = await withTimeout(consume(), 2000, `Gemini ${failure} 重试恢复`);
    if (content !== geminiText) throw new Error(`Gemini 重试未恢复内容：${content}`);
    if (signals.length !== 2) throw new Error(`Gemini 应尝试两次，实际 ${signals.length} 次`);
    if (signals[0] === signals[1]) throw new Error('Gemini 重试复用了上一尝试的 signal');
    if (failure === 'timeout' && !signals[0]!.aborted) throw new Error('Gemini deadline 未中止首次请求');
    if (controller.signal.aborted) throw new Error('Gemini 内部失败错误地中止了调用方');
  } finally {
    controller.abort();
  }
}

async function testGeminiNoReplay(failure: 'network' | 'timeout'): Promise<void> {
  let calls = 0;
  globalThis.fetch = ((input: Request | string | URL, init?: CapturedInit) => {
    calls++;
    const signal = input instanceof Request ? input.signal : init?.signal;
    if (!signal) throw new Error('Gemini 流请求未传入 signal');
    const encoder = new TextEncoder();
    let onAbort: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(geminiDelta));
        if (failure === 'network') {
          const event = { event_type: 'error', error: { message: 'fetch failed' } };
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(event)}\n\n`));
          controller.close();
          return;
        }
        onAbort = () => controller.error(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      },
      cancel() {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      },
    });
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  }) as typeof fetch;
  const controller = new AbortController();
  const provider = createGeminiProvider({ apiKey: 'k', timeout: 100 });
  let content = '';
  let thrown: unknown;
  try {
    await withTimeout(
      (async () => {
        for await (const chunk of provider.chatStream!({
          model: 'x',
          messages: [{ role: 'user', content: 'hi' }],
          signal: controller.signal,
        }))
          content += chunk.content ?? '';
      })(),
      2000,
      'Gemini 流建立后失败',
    );
  } catch (error) {
    thrown = error;
  } finally {
    controller.abort();
  }
  if (!(thrown instanceof ProviderError)) throw new Error(`Gemini 流未报告 ProviderError：${String(thrown)}`);
  if (failure === 'timeout' && thrown.errorCode !== 'timeout') throw new Error('Gemini 流超时分类错误');
  if (content !== geminiText || calls !== 1) throw new Error(`Gemini 流被重放：${calls} 次请求，内容 ${content}`);
}

const failures: string[] = [];
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.error(`  fail ${name}: ${(e as Error).message}`);
  }
}

for (const [label, make] of providers) await run(`${label} chat abort`, () => testChat(label, make));
for (const [label, make] of providers) await run(`${label} chatStream return`, () => testStream(label, make));
await run('pre-abort 不调用 fetch', testPreAbort);
for (const failure of ['network', 'timeout'] as const) {
  for (const streaming of [false, true]) {
    await run(`gemini ${streaming ? 'chatStream' : 'chat'} ${failure} 重试恢复`, () =>
      testGeminiRecovery(streaming, failure),
    );
  }
  await run(`gemini 流建立后 ${failure} 不重放`, () => testGeminiNoReplay(failure));
}

if (failures.length) {
  console.error(`\n${failures.length} 场景失败`);
  process.exit(1);
}
console.log('全部传输取消场景通过');
// fetch 挂起的 Promise 不会自然结束；确认失败后强制退出。
process.exit(0);
