// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { GenreDetectorAgent } from '../../src/agents/genre-detector.js';
import { defineProvider } from '../../src/providers/index.js';
import { createMockProvider } from '../helpers/mock-provider.js';
import type { Genre, StreamChunk } from '../../src/types.js';

// ── Helpers ──

function makeGenreDetectionJSON(genre: string = 'portrait', confidence: number = 0.95) {
  return JSON.stringify({ genre, confidence });
}

const IMAGE_URL = 'https://example.com/portrait.jpg';

describe('GenreDetectorAgent', () => {
  describe('detect()', () => {
    it('should return a valid GenreDetectionResult for portrait', async () => {
      const provider = createMockProvider([
        { content: makeGenreDetectionJSON('portrait', 0.95), reasoning: 'Analyzing subject focus...' },
      ]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const { result, reasoning } = await agent.detect(IMAGE_URL);

      expect(result.genre).toBe('portrait');
      expect(result.confidence).toBe(0.95);
      expect(reasoning).toBe('Analyzing subject focus...');
    });

    it('should detect landscape genre', async () => {
      const provider = createMockProvider([{ content: makeGenreDetectionJSON('landscape', 0.88) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const { result } = await agent.detect(IMAGE_URL);

      expect(result.genre).toBe('landscape');
      expect(result.confidence).toBe(0.88);
    });

    it('should detect sports genre', async () => {
      const provider = createMockProvider([{ content: makeGenreDetectionJSON('sports', 0.92) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const { result } = await agent.detect(IMAGE_URL);

      expect(result.genre).toBe('sports');
      expect(result.confidence).toBe(0.92);
    });

    it('should handle valid genres (all 8)', async () => {
      const validGenres: Genre[] = [
        'portrait',
        'landscape',
        'documentary',
        'fine_art',
        'commercial',
        'architecture',
        'nature',
        'sports',
      ];

      for (const genre of validGenres) {
        const provider = createMockProvider([{ content: makeGenreDetectionJSON(genre, 0.8) }]);
        const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

        const { result } = await agent.detect(IMAGE_URL);
        expect(result.genre).toBe(genre);
      }
    });

    it('should reject confidence > 1 (schema validation)', async () => {
      const provider = createMockProvider([{ content: JSON.stringify({ genre: 'portrait', confidence: 1.5 }) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model', maxRetries: 1 });

      await expect(agent.detect(IMAGE_URL)).rejects.toThrow();
    });

    it('should reject confidence < 0 (schema validation)', async () => {
      const provider = createMockProvider([{ content: JSON.stringify({ genre: 'portrait', confidence: -0.1 }) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model', maxRetries: 1 });

      await expect(agent.detect(IMAGE_URL)).rejects.toThrow();
    });

    it('should reject invalid genre (schema validation)', async () => {
      const provider = createMockProvider([{ content: JSON.stringify({ genre: 'invalid_genre', confidence: 0.5 }) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model', maxRetries: 1 });

      await expect(agent.detect(IMAGE_URL)).rejects.toThrow();
    });

    it('should handle null reasoning in response', async () => {
      const provider = createMockProvider([{ content: makeGenreDetectionJSON('nature', 0.85) }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const { result, reasoning } = await agent.detect(IMAGE_URL);

      expect(result.genre).toBe('nature');
      expect(reasoning).toBeNull();
    });

    it('should retry on JSON parse failure', async () => {
      const provider = createMockProvider([
        { content: 'not valid json' },
        { content: makeGenreDetectionJSON('documentary', 0.75) },
      ]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model', maxRetries: 3 });

      const { result } = await agent.detect(IMAGE_URL);

      expect(result.genre).toBe('documentary');
      expect(result.confidence).toBe(0.75);
    });

    it('should pass correct model to provider', async () => {
      let capturedModel: string | undefined;
      const provider = defineProvider({
        name: 'capture-provider',
        capabilities: { vision: true, reasoning: true, reasoningBudget: true },
        chat: async (params) => {
          capturedModel = params.model;
          return { content: makeGenreDetectionJSON(), reasoning: null };
        },
      });
      const agent = new GenreDetectorAgent(provider, { model: 'genre-detector-model' });

      await agent.detect(IMAGE_URL);
      expect(capturedModel).toBe('genre-detector-model');
    });
  });

  describe('detectStream()', () => {
    /** Helper: create a provider with chatStream support */
    function createStreamingProvider(chunks: StreamChunk[], opts?: { name?: string }) {
      return defineProvider({
        name: opts?.name ?? 'streaming-mock-provider',
        capabilities: { vision: true, reasoning: true, reasoningBudget: true },
        chat: async () => {
          // Fallback: assemble content from chunks
          const content = chunks.map((c) => c.content ?? '').join('');
          const reasoning = chunks.map((c) => c.reasoning ?? '').join('') || null;
          return { content, reasoning };
        },
        chatStream: async function* (_params) {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      });
    }

    it('should return an AsyncGenerator that can be iterated', async () => {
      const json = makeGenreDetectionJSON('portrait', 0.95);
      const provider = createStreamingProvider([{ content: json }]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const gen = agent.detectStream(IMAGE_URL);

      // Should be an async generator (has next method)
      expect(typeof gen.next).toBe('function');
      expect(typeof gen.return).toBe('function');
      expect(typeof gen.throw).toBe('function');

      // Iterate to completion
      const chunks: StreamChunk[] = [];
      let result: Awaited<ReturnType<typeof gen.next>>;
      do {
        result = await gen.next();
        if (!result.done && result.value) {
          chunks.push(result.value);
        }
      } while (!result.done);

      // Final return value should contain the parsed result
      expect(result.value.result.genre).toBe('portrait');
      expect(result.value.result.confidence).toBe(0.95);
    });

    it('should yield reasoning chunks during streaming', async () => {
      const json = makeGenreDetectionJSON('landscape', 0.88);
      const provider = createStreamingProvider([
        { reasoning: 'Analyzing composition...' },
        { reasoning: ' Checking horizon line...' },
        { content: json },
      ]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const chunks: StreamChunk[] = [];
      const gen = agent.detectStream(IMAGE_URL);

      let iterResult = await gen.next();
      while (!iterResult.done) {
        chunks.push(iterResult.value);
        iterResult = await gen.next();
      }
      const finalResult = iterResult.value;

      // Verify reasoning chunks were yielded
      const reasoningChunks = chunks.filter((c) => c.reasoning);
      expect(reasoningChunks.length).toBe(2);
      expect(reasoningChunks[0]!.reasoning).toBe('Analyzing composition...');
      expect(reasoningChunks[1]!.reasoning).toBe(' Checking horizon line...');

      // Final result should contain combined reasoning
      expect(finalResult.reasoning).toBe('Analyzing composition... Checking horizon line...');
    });

    it('should produce correct genre and confidence in final stream result', async () => {
      makeGenreDetectionJSON('fine_art', 0.91);
      const provider = createStreamingProvider([
        { reasoning: 'Evaluating artistic style...' },
        { content: '{"genre"' },
        { content: ':"fine_art","confidence":0.91}' },
      ]);
      const agent = new GenreDetectorAgent(provider, { model: 'test-model' });

      const chunks: StreamChunk[] = [];
      const gen = agent.detectStream(IMAGE_URL);

      let iterResult = await gen.next();
      while (!iterResult.done) {
        chunks.push(iterResult.value);
        iterResult = await gen.next();
      }

      const finalResult = iterResult.value;
      expect(finalResult.result.genre).toBe('fine_art');
      expect(finalResult.result.confidence).toBe(0.91);
      expect(finalResult.reasoning).toBe('Evaluating artistic style...');

      // Verify content chunks were also yielded
      const contentChunks = chunks.filter((c) => c.content);
      expect(contentChunks.length).toBeGreaterThanOrEqual(2);
    });
  });
});
