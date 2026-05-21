import { describe, it, expect } from 'bun:test';
import { BaseAgent } from '../../src/agents/base-agent.js';
import { defineProvider } from '../../src/providers/index.js';
import { createMockProvider } from '../helpers/mock-provider.js';
import { SchemaError } from '../../src/utils/errors.js';
import { z } from 'zod';
import type { LLMProvider } from '../../src/types.js';

// ── Helpers ──

const testSchema = z.object({
  score: z.number(),
  comment: z.string(),
});

function makeAgent(provider: LLMProvider, maxRetries?: number) {
  return new BaseAgent('test-agent', provider, {
    model: 'test-model',
    maxRetries,
  });
}

const VALID_JSON = JSON.stringify({ score: 8.5, comment: 'Great shot' });
const IMAGE_URL = 'https://example.com/photo.jpg';

describe('BaseAgent', () => {
  // ── 正常调用 LLM 并解析 JSON 响应 ──
  describe('Normal call — parse JSON response', () => {
    it('should call provider and return parsed + validated result', async () => {
      const provider = createMockProvider([{ content: VALID_JSON }]);
      const agent = makeAgent(provider);

      const { result, reasoning } = await agent.call('system prompt', 'user prompt', IMAGE_URL, testSchema);

      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
      expect(reasoning).toBeNull();
    });
  });

  // ── 推理链内容提取 ──
  describe('Reasoning content extraction', () => {
    it('should return reasoning when provider includes it', async () => {
      const provider = createMockProvider([
        { content: VALID_JSON, reasoning: 'I analyzed the composition carefully...' },
      ]);
      const agent = makeAgent(provider);

      const { result, reasoning } = await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
      expect(reasoning).toBe('I analyzed the composition carefully...');
    });
  });

  // ── 3次重试逻辑 ──
  describe('Retry logic (3 attempts)', () => {
    it('should retry and succeed on second attempt after invalid JSON', async () => {
      const provider = createMockProvider([
        { content: 'not json' }, // attempt 1: JSON parse fails
        { content: VALID_JSON }, // attempt 2: success
      ]);
      const agent = makeAgent(provider, 3);

      const { result } = await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
    });

    it('should retry and succeed on third attempt after schema errors', async () => {
      const provider = createMockProvider([
        { content: JSON.stringify({ score: 'wrong', comment: 123 }) }, // attempt 1: schema fail
        { content: JSON.stringify({ score: 5 }) }, // attempt 2: missing field
        { content: VALID_JSON }, // attempt 3: success
      ]);
      const agent = makeAgent(provider, 3);

      const { result } = await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
    });

    it('should throw SchemaError after all retries exhausted', async () => {
      const provider = createMockProvider([{ content: 'bad1' }, { content: 'bad2' }, { content: 'bad3' }]);
      const agent = makeAgent(provider, 3);

      await expect(agent.call('system', 'user', IMAGE_URL, testSchema)).rejects.toThrow(SchemaError);
    });
  });

  // ── JSON 解析失败时的错误处理 ──
  describe('JSON parse failure handling', () => {
    it('should throw SchemaError with ProviderError details when JSON is invalid after all retries', async () => {
      const provider = createMockProvider([
        { content: '{ broken json' },
        { content: '<<<not json>>>' },
        { content: '' },
      ]);
      const agent = makeAgent(provider, 3);

      try {
        await agent.call('system', 'user', IMAGE_URL, testSchema);
        expect(true).toBe(false); // should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaError);
        expect((e as SchemaError).message).toContain('3 次尝试后仍然失败');
      }
    });
  });

  // ── Provider 异常传播 ──
  describe('Provider exception propagation', () => {
    it('should throw SchemaError wrapping provider error after retries', async () => {
      const failProvider = defineProvider({
        name: 'fail-provider',
        capabilities: { vision: true },
        chat: async () => {
          throw new Error('Network timeout');
        },
      });
      const agent = makeAgent(failProvider, 3);

      try {
        await agent.call('system', 'user', IMAGE_URL, testSchema);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(SchemaError);
        expect((e as SchemaError).message).toContain('Network timeout');
      }
    });

    it('should propagate the last error message', async () => {
      let callCount = 0;
      const errorProvider = defineProvider({
        name: 'error-provider',
        capabilities: { vision: true },
        chat: async () => {
          callCount++;
          throw new Error(`Error on call ${callCount}`);
        },
      });
      const agent = makeAgent(errorProvider, 2);

      try {
        await agent.call('system', 'user', IMAGE_URL, testSchema);
        expect(true).toBe(false);
      } catch (e) {
        expect((e as Error).message).toContain('Error on call 2');
      }
    });
  });

  // ── 空响应处理 ──
  describe('Empty response handling', () => {
    it('should fail gracefully on empty content string', async () => {
      const provider = createMockProvider([{ content: '' }, { content: '' }, { content: '' }]);
      const agent = makeAgent(provider, 3);

      await expect(agent.call('system', 'user', IMAGE_URL, testSchema)).rejects.toThrow(SchemaError);
    });

    it('should fail gracefully on whitespace-only content', async () => {
      const provider = createMockProvider([{ content: '   ' }, { content: '   ' }, { content: '   ' }]);
      const agent = makeAgent(provider, 3);

      await expect(agent.call('system', 'user', IMAGE_URL, testSchema)).rejects.toThrow(SchemaError);
    });
  });

  // ── reasoning 参数传递（验证 reasoning 显式发送至 provider）──
  describe('Reasoning parameter passing', () => {
    it('should not pass reasoning to provider when reasoning is not configured', async () => {
      let capturedParams: Parameters<LLMProvider['chat']>[0] | null = null;
      const spyProvider = defineProvider({
        name: 'spy',
        capabilities: { vision: true },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', spyProvider, { model: 'test' });

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(capturedParams).not.toBeNull();
      expect(capturedParams!.reasoning).toBeUndefined();
    });

    it('should pass reasoning with budget when configured', async () => {
      let capturedParams: Parameters<LLMProvider['chat']>[0] | null = null;
      const spyProvider = defineProvider({
        name: 'spy',
        capabilities: { vision: true },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', spyProvider, {
        model: 'test',
        reasoning: { effort: 'medium', budgetTokens: 4096 },
      });

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(capturedParams!.reasoning).toEqual({ effort: 'medium', budgetTokens: 4096 });
    });

    it('should use callConfig override over agent config for reasoning', async () => {
      let capturedParams: Parameters<LLMProvider['chat']>[0] | null = null;
      const spyProvider = defineProvider({
        name: 'spy',
        capabilities: { vision: true },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      // Agent-level reasoning unset; callConfig provides it
      const agent = new BaseAgent('test', spyProvider, { model: 'test' });

      await agent.call('system', 'user', IMAGE_URL, testSchema, {
        reasoning: { effort: 'medium', budgetTokens: 2048 },
      });

      expect(capturedParams!.reasoning).toEqual({ effort: 'medium', budgetTokens: 2048 });
    });

    it('should not pass reasoning in callStream when reasoning is not configured', async () => {
      let capturedParams: Parameters<NonNullable<LLMProvider['chatStream']>>[0] | null = null;
      const spyProvider = defineProvider({
        name: 'spy-stream',
        capabilities: { vision: true },
        chatStream: async function* (params) {
          capturedParams = params;
          yield { content: VALID_JSON };
        },
        chat: async () => {
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', spyProvider, { model: 'test' });

      // consume generator; params captured on first call
      try {
        for await (const _ of agent.callStream('system', 'user', IMAGE_URL, testSchema)) {
          /* drain */
        }
      } catch {
        /* retry exhaustion is expected for empty stream; params already captured */
      }

      expect(capturedParams!.reasoning).toBeUndefined();
    });
  });
});
