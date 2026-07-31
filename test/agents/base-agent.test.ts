import { describe, it, expect } from 'bun:test';
import { BaseAgent } from '../../src/agents/base-agent.js';
import { defineProvider } from '../../src/providers/index.js';
import { createMockProvider } from '../helpers/mock-provider.js';
import { SchemaError } from '../../src/utils/errors.js';
import { z } from 'zod';
import type { LLMProvider, ChatParams } from '../../src/types.js';

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

  // ── callStream 降级路径 ──
  describe('callStream fallback to call()', () => {
    it('should fall back to call() when provider has no chatStream', async () => {
      let callCount = 0;
      const provider = defineProvider({
        name: 'no-stream-provider',
        capabilities: { vision: true },
        // No chatStream defined → callStream should degrade to call()
        chat: async (_params) => {
          callCount++;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = makeAgent(provider, 1);

      const gen = agent.callStream('system', 'user', IMAGE_URL, testSchema);
      const { value, done } = await gen.next();

      // Should have called chat (not chatStream) and returned result via generator
      expect(callCount).toBe(1);
      expect(done).toBe(true);
      expect(value).toEqual({ result: { score: 8.5, comment: 'Great shot' }, reasoning: null });
    });
  });

  // ── callStream 流式重试逻辑 ──
  describe('callStream retry logic', () => {
    it('should retry on JSON parse failure in stream and succeed', async () => {
      let callCount = 0;
      const streamProvider = defineProvider({
        name: 'stream-retry-provider',
        capabilities: { vision: true, streaming: true },
        chatStream: async function* () {
          callCount++;
          if (callCount === 1) {
            yield { content: 'not valid json' };
          } else {
            yield { content: VALID_JSON };
          }
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = new BaseAgent('test', streamProvider, { model: 'test', maxRetries: 3 });

      const results: unknown[] = [];
      for await (const chunk of agent.callStream('system', 'user', IMAGE_URL, testSchema)) {
        results.push(chunk);
      }

      expect(callCount).toBe(2);
    });

    it('should retry on schema validation failure in stream and succeed', async () => {
      let callCount = 0;
      const streamProvider = defineProvider({
        name: 'stream-schema-retry-provider',
        capabilities: { vision: true, streaming: true },
        chatStream: async function* () {
          callCount++;
          if (callCount === 1) {
            yield { content: JSON.stringify({ score: 'wrong_type', comment: 123 }) };
          } else if (callCount === 2) {
            yield { content: JSON.stringify({ score: 5 }) };
          } else {
            yield { content: VALID_JSON };
          }
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = new BaseAgent('test', streamProvider, { model: 'test', maxRetries: 3 });

      const results: unknown[] = [];
      for await (const chunk of agent.callStream('system', 'user', IMAGE_URL, testSchema)) {
        results.push(chunk);
      }

      expect(callCount).toBe(3);
    });
  });

  // ── json_schema 模式（双模式）──
  describe('Structured output: json_schema mode', () => {
    it('should call provider once without retry when structuredOutput is json_schema', async () => {
      let callCount = 0;
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-provider',
        capabilities: { vision: true, structuredOutput: 'json_schema' },
        chat: async () => {
          callCount++;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', jsonSchemaProvider, { model: 'test', maxRetries: 3 });

      const { result } = await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(callCount).toBe(1);
      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
    });

    it('should pass response_format with json_schema type, name, schema, and strict:true', async () => {
      let capturedParams: ChatParams | null = null;
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-provider',
        capabilities: { vision: true, structuredOutput: 'json_schema' },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('my-agent', jsonSchemaProvider, { model: 'test' });

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(capturedParams).not.toBeNull();
      expect(capturedParams!.response_format).toBeDefined();
      expect(capturedParams!.response_format!.type).toBe('json_schema');
      // Verify json_schema fields
      const fmt = capturedParams!.response_format as { type: string; name: string; schema: unknown; strict: boolean };
      expect(fmt.name).toBe('my-agent'); // hyphens preserved by regex
      expect(fmt.strict).toBe(true);
      expect(typeof fmt.schema).toBe('object');
    });

    it('should NOT apply Zod validation in json_schema mode (schema-invalid JSON passes)', async () => {
      // Return JSON that is parseable but does NOT match testSchema (score is string, comment is number)
      const invalidSchemaJSON = JSON.stringify({ score: 'not-a-number', comment: 123 });
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-provider',
        capabilities: { vision: true, structuredOutput: 'json_schema' },
        chat: async () => {
          return { content: invalidSchemaJSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', jsonSchemaProvider, { model: 'test', maxRetries: 3 });

      // In json_schema mode, Zod validation is skipped — so this should NOT throw
      const { result } = await agent.call('system', 'user', IMAGE_URL, testSchema);
      expect(result).toEqual({ score: 'not-a-number', comment: 123 });
    });

    it('should still throw on unparseable JSON in json_schema mode (no retry)', async () => {
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-provider',
        capabilities: { vision: true, structuredOutput: 'json_schema' },
        chat: async () => {
          return { content: 'not valid json', reasoning: null };
        },
      });
      const agent = new BaseAgent('test', jsonSchemaProvider, { model: 'test', maxRetries: 3 });

      await expect(agent.call('system', 'user', IMAGE_URL, testSchema)).rejects.toThrow('JSON parse failed');
    });

    it('callStream should use single stream call without retry in json_schema mode', async () => {
      let callCount = 0;
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-stream',
        capabilities: { vision: true, streaming: true, structuredOutput: 'json_schema' },
        chatStream: async function* (_params) {
          callCount++;
          yield { content: '{"score":' };
          yield { content: '8.5,"comment":"Great shot"}' };
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = new BaseAgent('test', jsonSchemaProvider, { model: 'test', maxRetries: 3 });

      const chunks: unknown[] = [];
      let finalResult: unknown;
      const gen = agent.callStream('system', 'user', IMAGE_URL, testSchema);
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          finalResult = value;
          break;
        }
        chunks.push(value);
      }

      expect(callCount).toBe(1);
      expect(chunks.length).toBe(2);
      expect((finalResult as any).result).toEqual({ score: 8.5, comment: 'Great shot' });
    });

    it('callStream should pass json_schema response_format to provider', async () => {
      let capturedParams: ChatParams | null = null;
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-stream',
        capabilities: { vision: true, streaming: true, structuredOutput: 'json_schema' },
        chatStream: async function* (params) {
          capturedParams = params;
          yield { content: VALID_JSON };
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = new BaseAgent('test-agent', jsonSchemaProvider, { model: 'test' });

      for await (const _ of agent.callStream('system', 'user', IMAGE_URL, testSchema)) {
        /* drain */
      }

      expect(capturedParams).not.toBeNull();
      expect(capturedParams!.response_format!.type).toBe('json_schema');
      const fmt = capturedParams!.response_format as { type: string; name: string; strict: boolean };
      expect(fmt.name).toBe('test-agent');
      expect(fmt.strict).toBe(true);
    });

    it('callStream should NOT apply Zod validation in json_schema mode', async () => {
      const invalidSchemaJSON = JSON.stringify({ score: 'wrong', comment: 999 });
      const jsonSchemaProvider = defineProvider({
        name: 'json-schema-stream',
        capabilities: { vision: true, streaming: true, structuredOutput: 'json_schema' },
        chatStream: async function* () {
          yield { content: invalidSchemaJSON };
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = new BaseAgent('test', jsonSchemaProvider, { model: 'test', maxRetries: 3 });

      let finalResult: unknown;
      const gen = agent.callStream('system', 'user', IMAGE_URL, testSchema);
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          finalResult = value;
          break;
        }
      }

      // Schema-invalid result passes through without Zod throwing
      expect((finalResult as any).result).toEqual({ score: 'wrong', comment: 999 });
    });
  });

  // ── json_object 模式（默认行为确认）──
  describe('Structured output: json_object mode (default)', () => {
    it('should pass response_format json_object when structuredOutput is not json_schema', async () => {
      let capturedParams: ChatParams | null = null;
      const provider = defineProvider({
        name: 'json-object-provider',
        capabilities: { vision: true, structuredOutput: 'json_object' },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', provider, { model: 'test' });

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(capturedParams!.response_format).toEqual({ type: 'json_object' });
    });

    it('should pass response_format json_object when structuredOutput is undefined', async () => {
      let capturedParams: ChatParams | null = null;
      const provider = defineProvider({
        name: 'default-provider',
        capabilities: { vision: true },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', provider, { model: 'test' });

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(capturedParams!.response_format).toEqual({ type: 'json_object' });
    });

    it('should apply Zod validation and retry in json_object mode', async () => {
      let callCount = 0;
      const provider = defineProvider({
        name: 'json-object-provider',
        capabilities: { vision: true, structuredOutput: 'json_object' },
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            // Return schema-invalid JSON
            return { content: JSON.stringify({ score: 'bad', comment: 123 }), reasoning: null };
          }
          return { content: VALID_JSON, reasoning: null };
        },
      });
      const agent = new BaseAgent('test', provider, { model: 'test', maxRetries: 3 });

      const { result } = await agent.call('system', 'user', IMAGE_URL, testSchema);

      expect(callCount).toBe(2);
      expect(result).toEqual({ score: 8.5, comment: 'Great shot' });
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

  // ── 多图 imageUrl 支持（string | string[]）──
  describe('Multi-image imageUrl support', () => {
    const URLS = ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'];

    function makeCapturingProvider() {
      let capturedParams: ChatParams | null = null;
      const provider = defineProvider({
        name: 'capture-provider',
        capabilities: { vision: true },
        chat: async (params) => {
          capturedParams = params;
          return { content: VALID_JSON, reasoning: null };
        },
      });
      return { provider, getParams: () => capturedParams };
    }

    function extractImageParts(params: ChatParams) {
      const userMsg = params.messages.find((m) => m.role === 'user')!;
      const parts = userMsg.content as Exclude<typeof userMsg.content, string>;
      return {
        parts,
        imageParts: parts.filter((p) => p.type === 'image_url') as Array<{
          type: 'image_url';
          image_url: { url: string };
        }>,
      };
    }

    it('should push one image_url part per URL in input order when imageUrl is an array', async () => {
      const { provider, getParams } = makeCapturingProvider();
      const agent = makeAgent(provider);

      await agent.call('system', 'user', URLS, testSchema);

      const { parts, imageParts } = extractImageParts(getParams()!);
      expect(parts[0]).toEqual({ type: 'text', text: 'user' });
      expect(imageParts).toHaveLength(3);
      expect(imageParts.map((p) => p.image_url.url)).toEqual(URLS);
    });

    it('should skip empty-string URLs in the array (truthy-only push preserved)', async () => {
      const { provider, getParams } = makeCapturingProvider();
      const agent = makeAgent(provider);

      await agent.call('system', 'user', [URLS[0]!, '', URLS[2]!], testSchema);

      const { imageParts } = extractImageParts(getParams()!);
      expect(imageParts).toHaveLength(2);
      expect(imageParts.map((p) => p.image_url.url)).toEqual([URLS[0]!, URLS[2]!]);
    });

    it('should keep single-string behavior unchanged (exactly one image part)', async () => {
      const { provider, getParams } = makeCapturingProvider();
      const agent = makeAgent(provider);

      await agent.call('system', 'user', IMAGE_URL, testSchema);

      const { imageParts } = extractImageParts(getParams()!);
      expect(imageParts).toHaveLength(1);
      expect(imageParts[0]!.image_url.url).toBe(IMAGE_URL);
    });

    it('callStream should include all image parts in order when imageUrl is an array', async () => {
      let capturedParams: ChatParams | null = null;
      const streamProvider = defineProvider({
        name: 'capture-stream-provider',
        capabilities: { vision: true, streaming: true },
        chatStream: async function* (params) {
          capturedParams = params;
          yield { content: VALID_JSON };
        },
        chat: async () => ({ content: VALID_JSON, reasoning: null }),
      });
      const agent = makeAgent(streamProvider);

      for await (const _ of agent.callStream('system', 'user', URLS, testSchema)) {
        /* drain */
      }

      const { imageParts } = extractImageParts(capturedParams!);
      expect(imageParts).toHaveLength(3);
      expect(imageParts.map((p) => p.image_url.url)).toEqual(URLS);
    });
  });
});
