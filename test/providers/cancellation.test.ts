// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 传输取消测试 — 必须在独立 Bun 子进程中运行。
 * 原因：其他测试文件通过 mock.module('openai') 全局替换 SDK；跨文件 mock 泄漏
 * 会污染本测试使用的真实 SDK 代码路径。子进程保证未被 mock 的模块图。
 */

import { describe, it, expect } from 'bun:test';
import { geminiRequest } from '../../src/providers/gemini-request.js';
import { AbortError, ProviderError, SchemaError } from '../../src/utils/errors.js';
import { deferred, watchdog } from '../helpers/cancellation.js';

describe('Gemini 请求级重试与取消', () => {
  const options = { timeout: 0, provider: 'gemini-test' };

  it.each(['network', 'timeout'] as const)('%s 失败后可重试恢复', async (code) => {
    let attempts = 0;
    const error = Object.assign(new ProviderError('请求失败', options.provider, code), {
      headers: { 'retry-after-ms': '1' },
    });
    const request = await watchdog(
      geminiRequest(async () => {
        if (++attempts === 1) throw error;
        return 42;
      }, options),
    );
    try {
      expect(request.value).toBe(42);
      expect(attempts).toBe(2);
    } finally {
      request.dispose();
    }
  });

  it.each(['network', 'timeout'] as const)('%s 最多额外重试四次并保留错误分类', async (code) => {
    let attempts = 0;
    const error = Object.assign(new ProviderError('请求失败', options.provider, code), {
      headers: { 'retry-after-ms': '1' },
    });
    await expect(
      watchdog(
        geminiRequest(async () => {
          attempts++;
          throw error;
        }, options),
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(5);
  });

  it.each([408, 409, 429, 500, 503, 599])('HTTP %i 仍能重试恢复', async (status) => {
    let attempts = 0;
    const request = await watchdog(
      geminiRequest(async () => {
        if (++attempts === 1) {
          throw Object.assign(new Error('请求失败'), { status, headers: { 'retry-after-ms': '1' } });
        }
        return 42;
      }, options),
    );
    try {
      expect(request.value).toBe(42);
      expect(attempts).toBe(2);
    } finally {
      request.dispose();
    }
  });

  it.each([400, 401, 403, 422])('HTTP %i 不因错误消息包含网络或超时字样而重试', async (status) => {
    let attempts = 0;
    await expect(
      geminiRequest(async () => {
        attempts++;
        throw Object.assign(new Error('fetch failed or timed out'), {
          status,
          headers: { 'retry-after-ms': '1' },
        });
      }, options),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(attempts).toBe(1);
  });

  it.each([new SyntaxError('Invalid JSON'), new SchemaError('Invalid schema')])(
    '解析或 schema 错误不重试：%s',
    async (error) => {
      let attempts = 0;
      await expect(
        geminiRequest(async () => {
          attempts++;
          throw error;
        }, options),
      ).rejects.toBeInstanceOf(ProviderError);
      expect(attempts).toBe(1);
    },
  );

  it('内部 deadline 超时后以独立信号重试，成功结果不被当作用户取消', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const request = await watchdog(
      geminiRequest(
        (signal) => {
          signals.push(signal);
          if (signals.length > 1) return Promise.resolve(42);
          return new Promise<number>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
        { ...options, timeout: 10, signal: controller.signal },
      ),
    );
    try {
      expect(request.value).toBe(42);
      expect(signals).toHaveLength(2);
      expect(signals[0]).not.toBe(signals[1]);
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);
      expect(controller.signal.aborted).toBe(false);
    } finally {
      request.dispose();
    }
  });

  it.each(['network', 'timeout'] as const)('%s 重试退避期间取消不再发送请求', async (code) => {
    const controller = new AbortController();
    const backoffStarted = deferred();
    let attempts = 0;
    const error = Object.assign(new ProviderError('请求失败', options.provider, code), {
      headers: { 'retry-after-ms': '60000' },
    });
    Object.defineProperty(error, 'headers', {
      get() {
        backoffStarted.resolve();
        return { 'retry-after-ms': '60000' };
      },
    });
    const outcome = geminiRequest(
      async () => {
        attempts++;
        throw error;
      },
      { ...options, signal: controller.signal },
    ).catch((caught: unknown) => caught);
    try {
      await watchdog(backoffStarted.promise);
      controller.abort();
      expect(await watchdog(outcome)).toBeInstanceOf(AbortError);
      expect(attempts).toBe(1);
    } finally {
      controller.abort();
      await outcome;
    }
  });
});

describe('Provider 传输取消（独立进程真实 SDK）', () => {
  it('四种内置 Provider 的 chat/chatStream 在 abort/return 时同步中止底层 fetch', () => {
    const repoRoot = new URL('../../', import.meta.url).pathname;
    const proc = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/verify-cancellation-transport.ts'],
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });
    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    if (proc.exitCode !== 0) {
      throw new Error(`传输取消验证失败（exit ${proc.exitCode}）：\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    expect(stdout).toContain('全部传输取消场景通过');
  });
});
