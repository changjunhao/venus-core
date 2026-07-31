// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import { toJSONSchema } from 'zod';
import { getGroupJointSchemas, getGroupCompareSchemas } from '../../src/schema/group.js';
import { getGenreConfig } from '../../src/schema/index.js';
import { makeDimensions } from '../helpers/mock-data.js';

// ── Helpers ──

const PORTRAIT_DIMS = getGenreConfig('portrait').dimensions;

function validJointProposal(overrides: Record<string, unknown> = {}) {
  return {
    scene_type: 'studio',
    total_score: 7.5,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
    group_analysis: '整体叙事完整，风格统一。',
    critique: '组照完成度较高。',
    suggestions: '可增强收尾照片的力度。',
    ...overrides,
  };
}

function validPerImage(count: number) {
  return Array.from({ length: count }, (_, i) => ({ index: i, score: 7.0, comment: `第${i + 1}张点评` }));
}

function validRanking(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    rank: i + 1,
    score: 8.0 - i * 0.5,
    rationale: `排名依据 ${i + 1}`,
  }));
}

function validCompareProposal(count: number, overrides: Record<string, unknown> = {}) {
  return {
    ranking: validRanking(count),
    comparison_summary: '整组照片水平接近，第 1 张最佳。',
    suggestions: '统一后期风格。',
    ...overrides,
  };
}

describe('Group Schemas', () => {
  // ── getGroupJointSchemas ──
  describe('getGroupJointSchemas()', () => {
    it('should parse a valid joint proposal (includePerImage=false)', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', false, 3);
      const result = proposalSchema.parse(validJointProposal());
      expect(result.scene_type).toBe('studio');
      expect(result.group_analysis).toContain('叙事');
    });

    it('should reject a joint proposal missing group_analysis', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', false, 3);
      const { group_analysis: _group_analysis, ...invalid } = validJointProposal();
      expect(() => proposalSchema.parse(invalid)).toThrow();
    });

    it('should reject out-of-range total_score and invalid scene_type', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', false, 3);
      expect(() => proposalSchema.parse(validJointProposal({ total_score: 11 }))).toThrow();
      expect(() => proposalSchema.parse(validJointProposal({ scene_type: 'not_a_subtype' }))).toThrow();
    });

    it('arbiterSchema should require arbitration_notes', () => {
      const { arbiterSchema } = getGroupJointSchemas('portrait', false, 3);
      expect(() => arbiterSchema.parse(validJointProposal())).toThrow();
      const result = arbiterSchema.parse(validJointProposal({ arbitration_notes: '维持原判。' }));
      expect(result.arbitration_notes).toBe('维持原判。');
    });

    it('should strip per_image when includePerImage=false (z.object strip semantics)', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', false, 3);
      const result = proposalSchema.parse(validJointProposal({ per_image: validPerImage(3) }));
      expect(Object.keys(result)).not.toContain('per_image');
    });

    it('should require per_image with exact length when includePerImage=true', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', true, 3);
      // 缺失 per_image → 失败
      expect(() => proposalSchema.parse(validJointProposal())).toThrow();
      // 长度不匹配 → 失败
      expect(() => proposalSchema.parse(validJointProposal({ per_image: validPerImage(2) }))).toThrow();
      // 合法 → 通过
      const result = proposalSchema.parse(validJointProposal({ per_image: validPerImage(3) }));
      expect(result.per_image).toHaveLength(3);
    });

    it('should reject per_image index out of bounds', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', true, 3);
      const perImage = validPerImage(3);
      perImage[2]!.index = 3; // 超出 0..2
      expect(() => proposalSchema.parse(validJointProposal({ per_image: perImage }))).toThrow();
    });

    it('should reject per_image with duplicate indices', () => {
      const { proposalSchema } = getGroupJointSchemas('portrait', true, 3);
      const perImage = validPerImage(3);
      perImage[2]!.index = 0; // 与第 1 项重复
      expect(() => proposalSchema.parse(validJointProposal({ per_image: perImage }))).toThrow();
    });
  });

  // ── getGroupCompareSchemas ──
  describe('getGroupCompareSchemas()', () => {
    it('should parse a valid compare proposal', () => {
      const { proposalSchema } = getGroupCompareSchemas(4, false);
      const result = proposalSchema.parse(validCompareProposal(4));
      expect(result.ranking).toHaveLength(4);
      expect(result.comparison_summary).toContain('最佳');
    });

    it('should reject ranking with wrong length', () => {
      const { proposalSchema } = getGroupCompareSchemas(4, false);
      expect(() => proposalSchema.parse(validCompareProposal(4, { ranking: validRanking(3) }))).toThrow();
    });

    it('should reject ranking index out of bounds', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const ranking = validRanking(3);
      ranking[0]!.index = 3; // 超出 0..2
      expect(() => proposalSchema.parse(validCompareProposal(3, { ranking }))).toThrow();
    });

    it('should reject rank out of bounds (0 or > imageCount)', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const rankZero = validRanking(3);
      rankZero[0]!.rank = 0;
      expect(() => proposalSchema.parse(validCompareProposal(3, { ranking: rankZero }))).toThrow();
      const rankOver = validRanking(3);
      rankOver[2]!.rank = 4;
      expect(() => proposalSchema.parse(validCompareProposal(3, { ranking: rankOver }))).toThrow();
    });

    it('should reject ranking with duplicate index', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const ranking = validRanking(3);
      ranking[2]!.index = 0; // 与第 1 项重复（rank 仍为 1..3 全排列）
      expect(() => proposalSchema.parse(validCompareProposal(3, { ranking }))).toThrow();
    });

    it('should reject ranking with duplicate rank', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const ranking = validRanking(3);
      ranking[2]!.rank = 1; // 与第 1 项重复（index 仍为 0..2 无重复）
      expect(() => proposalSchema.parse(validCompareProposal(3, { ranking }))).toThrow();
    });

    it('should accept ranking whose ranks form a full permutation in any order', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const ranking = [
        { index: 0, rank: 3, score: 6.0, rationale: '排名依据 3' },
        { index: 1, rank: 1, score: 8.5, rationale: '排名依据 1' },
        { index: 2, rank: 2, score: 7.0, rationale: '排名依据 2' },
      ];
      const result = proposalSchema.parse(validCompareProposal(3, { ranking }));
      expect(result.ranking.map((r) => r.rank)).toEqual([3, 1, 2]);
    });

    it('should reject per_image with duplicate indices', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, true);
      const perImage = validPerImage(3);
      perImage[1]!.index = 2; // 与第 3 项重复
      expect(() => proposalSchema.parse(validCompareProposal(3, { per_image: perImage }))).toThrow();
    });

    it('should strip per_image when includePerImage=false', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, false);
      const result = proposalSchema.parse(validCompareProposal(3, { per_image: validPerImage(3) }));
      expect(Object.keys(result)).not.toContain('per_image');
    });

    it('should require per_image with exact length when includePerImage=true', () => {
      const { proposalSchema } = getGroupCompareSchemas(3, true);
      expect(() => proposalSchema.parse(validCompareProposal(3))).toThrow();
      const result = proposalSchema.parse(validCompareProposal(3, { per_image: validPerImage(3) }));
      expect(result.per_image).toHaveLength(3);
    });

    it('arbiterSchema should require arbitration_notes', () => {
      const { arbiterSchema } = getGroupCompareSchemas(3, false);
      expect(() => arbiterSchema.parse(validCompareProposal(3))).toThrow();
      const result = arbiterSchema.parse(validCompareProposal(3, { arbitration_notes: '采纳排名调整建议。' }));
      expect(result.arbitration_notes).toContain('采纳');
    });
  });

  // ── json_schema 兼容性 ──
  describe('toJSONSchema compatibility', () => {
    it('should convert schemas carrying superRefine without throwing', () => {
      const compare = getGroupCompareSchemas(3, true);
      const joint = getGroupJointSchemas('portrait', true, 3);
      for (const schema of [compare.proposalSchema, compare.arbiterSchema, joint.proposalSchema, joint.arbiterSchema]) {
        expect(() => toJSONSchema(schema)).not.toThrow();
      }
      const jsonSchema = toJSONSchema(compare.proposalSchema) as Record<string, unknown>;
      expect((jsonSchema.properties as Record<string, unknown>).ranking).toBeDefined();
    });
  });

  // ── 缓存 ──
  describe('Schema caching', () => {
    it('should return the same reference for identical joint args', () => {
      const a = getGroupJointSchemas('portrait', true, 3);
      const b = getGroupJointSchemas('portrait', true, 3);
      expect(a).toBe(b);
      expect(a.proposalSchema).toBe(b.proposalSchema);
      expect(a.arbiterSchema).toBe(b.arbiterSchema);
    });

    it('should return different schemas for different joint cache keys', () => {
      const base = getGroupJointSchemas('portrait', false, 3);
      expect(getGroupJointSchemas('portrait', true, 3)).not.toBe(base);
      expect(getGroupJointSchemas('portrait', false, 4)).not.toBe(base);
      expect(getGroupJointSchemas('landscape', false, 3)).not.toBe(base);
    });

    it('should return the same reference for identical compare args', () => {
      const a = getGroupCompareSchemas(5, false);
      const b = getGroupCompareSchemas(5, false);
      expect(a).toBe(b);
      expect(a.proposalSchema).toBe(b.proposalSchema);
    });

    it('should return different schemas for different compare cache keys', () => {
      const base = getGroupCompareSchemas(5, false);
      expect(getGroupCompareSchemas(5, true)).not.toBe(base);
      expect(getGroupCompareSchemas(6, false)).not.toBe(base);
    });
  });
});
