import { describe, it, expect } from 'bun:test';
import { getSchemas, getGenreConfig, getMetadata, getAllGenres, type Genre } from '../src/schema/index.js';
import { getProposerResultSchema } from '../src/schema/index.js';
import { ALL_GENRES } from './helpers/mock-data.js';

describe('Schema Layer', () => {
  // ── getAllGenres ──
  describe('getAllGenres()', () => {
    it('should return all 8 genres', () => {
      const genres = getAllGenres();
      expect(genres).toHaveLength(8);
      for (const g of ALL_GENRES) {
        expect(genres).toContain(g);
      }
    });
  });

  // ── getSchemas — 8 门类 Schema 正确生成 ──
  describe('getSchemas()', () => {
    it.each(ALL_GENRES)('should generate ProposalSchema/CritiqueSchema/ArbiterSchema for "%s"', (genre: Genre) => {
      const schemas = getSchemas(genre);
      expect(schemas).toBeDefined();
      expect(schemas.proposalSchema).toBeDefined();
      expect(schemas.critiqueSchema).toBeDefined();
      expect(schemas.arbiterSchema).toBeDefined();
    });

    it('should throw for unknown genre', () => {
      // @ts-expect-error testing runtime error for invalid genre
      expect(() => getSchemas('unknown_genre')).toThrow('Unknown genre');
    });
  });

  // ── 动态维度 schema ──
  describe('Dynamic dimension schema', () => {
    it.each(ALL_GENRES)('ProposalSchema dimensions keys match getGenreConfig() for "%s"', (genre: Genre) => {
      const { proposalSchema } = getSchemas(genre);
      const config = getGenreConfig(genre);

      // Build a valid object to extract the dimensions shape
      const dimShape = (proposalSchema.shape as any).dimensions.shape;
      const schemaKeys = Object.keys(dimShape);

      expect(schemaKeys.sort()).toEqual([...config.dimensions].sort());
    });
  });

  // ── ProposerResultSchema camelCase ──
  describe('ProposerResultSchema', () => {
    it('should parse a valid camelCase EvaluationResult object for portrait', () => {
      const genre = 'portrait';
      const config = getGenreConfig(genre);
      // Ensure schemas are cached first
      getSchemas(genre);
      const schema = getProposerResultSchema(genre);

      const dims: Record<string, number> = {};
      for (const d of config.dimensions) {
        dims[d] = 7.0;
      }

      const validResult = {
        imageUrl: 'https://example.com/photo.jpg',
        genre: 'portrait',
        sceneType: 'studio',
        totalScore: 7.5,
        dimensions: dims,
        critique: 'Good portrait work.',
        suggestions: 'Try better lighting.',
        arbitrationNotes: 'Balanced assessment.',
        process: {
          proposal: {
            result: {
              scene_type: 'studio',
              total_score: 7.5,
              dimensions: dims,
              critique: 'Nice.',
              suggestions: 'Improve.',
            },
            thinking: null,
          },
          critique: {
            result: {
              scene_type_review: {
                proposer_scene: 'studio',
                is_correct: true,
                correct_scene: null,
                reason: 'Correct classification.',
              },
              challenges: [],
              severity: 'LOW',
              overall_assessment: 'Looks good.',
              suggested_total_score: 7.5,
            },
            thinking: null,
          },
          arbitration: {
            result: {
              scene_type: 'studio',
              total_score: 7.5,
              dimensions: dims,
              critique: 'Final critique.',
              suggestions: 'Final suggestions.',
              arbitration_notes: 'Resolved.',
            },
            thinking: null,
          },
        },
        metadata: {
          evaluatedAt: new Date().toISOString(),
          durationMs: 1234,
          rounds: 3,
        },
      };

      const parsed = schema.parse(validResult);
      expect(parsed.totalScore).toBe(7.5);
      expect(parsed.sceneType).toBe('studio');
      expect(parsed.genre).toBe('portrait');
    });
  });

  // ── getMetadata() 完整性 ──
  describe('getMetadata()', () => {
    it('should return metadata for all 8 genres', () => {
      const metadata = getMetadata();
      const keys = Object.keys(metadata);
      expect(keys).toHaveLength(8);
      for (const g of ALL_GENRES) {
        expect(metadata[g]).toBeDefined();
        expect(metadata[g]!.label).toBeTruthy();
        expect(metadata[g]!.dimensionLabels).toBeArray();
        expect(metadata[g]!.subtypes).toBeArray();
        expect(metadata[g]!.dimensions).toBeArray();
      }
    });

    it('each genre metadata dimensions should have key and label', () => {
      const metadata = getMetadata();
      for (const g of ALL_GENRES) {
        for (const dim of metadata[g]!.dimensions) {
          expect(dim).toHaveProperty('key');
          expect(dim).toHaveProperty('label');
        }
        for (const sub of metadata[g]!.subtypes) {
          expect(sub).toHaveProperty('value');
          expect(sub).toHaveProperty('label');
        }
      }
    });
  });

  // ── Schema 缓存 ──
  describe('Schema caching', () => {
    it('should return same reference for same genre on subsequent calls', () => {
      const first = getSchemas('landscape');
      const second = getSchemas('landscape');
      expect(first.proposalSchema).toBe(second.proposalSchema);
      expect(first.arbiterSchema).toBe(second.arbiterSchema);
      expect(first.critiqueSchema).toBe(second.critiqueSchema);
    });
  });
});
