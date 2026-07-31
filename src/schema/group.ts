// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 组图评估 Schema 工厂
 * joint（联合评估）与 compare（对比评估）两种模式的 Proposal / Arbiter Schema。
 * Critic 轮直接复用 index.ts 中的通用 CritiqueSchema。
 *
 * 注意 json_schema 严格模式约束：per_image 采用「两套独立缓存 Schema」而非
 * optional 字段表达条件性 —— includePerImage=false 时 Schema 完全不含 per_image。
 */

import { z } from 'zod';
import { getSubtypeEnum, scoreField, buildDimensionsSchema, type Genre } from './index.js';
import type {
  GroupJointProposerResult,
  GroupJointArbitrationResult,
  GroupCompareProposerResult,
  GroupCompareArbitrationResult,
} from '../types.js';

// ============================================================
// 1. 共享字段辅助
// ============================================================

/** per_image 逐图明细数组：定长 imageCount，index 取值 0..imageCount-1 且不得重复 */
function buildPerImageSchema(imageCount: number) {
  return z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .min(0)
          .max(imageCount - 1),
        score: scoreField(),
        comment: z.string().min(1),
      }),
    )
    .length(imageCount)
    .superRefine((items, ctx) => {
      if (new Set(items.map((item) => item.index)).size !== items.length) {
        ctx.addIssue({
          code: 'custom',
          message: `per_image indices must be unique and cover exactly 0..${imageCount - 1}`,
        });
      }
    });
}

// ============================================================
// 2. 工厂函数 — 动态创建组图 Schema
// ============================================================

interface GroupJointSchemaSet {
  proposalSchema: z.ZodType<GroupJointProposerResult>;
  arbiterSchema: z.ZodType<GroupJointArbitrationResult>;
}

interface GroupCompareSchemaSet {
  proposalSchema: z.ZodType<GroupCompareProposerResult>;
  arbiterSchema: z.ZodType<GroupCompareArbitrationResult>;
}

function createGroupJointSchemas(genre: Genre, includePerImage: boolean, imageCount: number): GroupJointSchemaSet {
  const baseShape = {
    scene_type: getSubtypeEnum(genre),
    total_score: scoreField(),
    dimensions: buildDimensionsSchema(genre),
    group_analysis: z.string().min(1),
    critique: z.string().min(1),
    suggestions: z.string().min(1),
  };
  const shape = includePerImage ? { ...baseShape, per_image: buildPerImageSchema(imageCount) } : baseShape;
  return {
    proposalSchema: z.object(shape),
    arbiterSchema: z.object({ ...shape, arbitration_notes: z.string().min(1) }),
  };
}

function createGroupCompareSchemas(imageCount: number, includePerImage: boolean): GroupCompareSchemaSet {
  const baseShape = {
    ranking: z
      .array(
        z.object({
          index: z
            .number()
            .int()
            .min(0)
            .max(imageCount - 1),
          rank: z.number().int().min(1).max(imageCount),
          score: scoreField(),
          rationale: z.string().min(1),
        }),
      )
      .length(imageCount)
      .superRefine((items, ctx) => {
        if (new Set(items.map((item) => item.index)).size !== items.length) {
          ctx.addIssue({
            code: 'custom',
            message: `ranking indices must be unique and cover exactly 0..${imageCount - 1}`,
          });
        }
        if (new Set(items.map((item) => item.rank)).size !== items.length) {
          ctx.addIssue({
            code: 'custom',
            message: `ranking ranks must be a permutation of 1..${imageCount} without duplicates`,
          });
        }
      }),
    comparison_summary: z.string().min(1),
    suggestions: z.string().min(1),
  };
  const shape = includePerImage ? { ...baseShape, per_image: buildPerImageSchema(imageCount) } : baseShape;
  return {
    proposalSchema: z.object(shape),
    arbiterSchema: z.object({ ...shape, arbitration_notes: z.string().min(1) }),
  };
}

// ============================================================
// 3. Schema 缓存
// ============================================================

const jointCache = new Map<string, GroupJointSchemaSet>();
const compareCache = new Map<string, GroupCompareSchemaSet>();

// ============================================================
// 4. 公共 API
// ============================================================

/** 根据 genre / includePerImage / imageCount 返回组图联合评估的 { proposalSchema, arbiterSchema } */
export function getGroupJointSchemas(genre: Genre, includePerImage: boolean, imageCount: number): GroupJointSchemaSet {
  const key = `${genre}:${includePerImage}:${imageCount}`;
  let cached = jointCache.get(key);
  if (!cached) {
    cached = createGroupJointSchemas(genre, includePerImage, imageCount);
    jointCache.set(key, cached);
  }
  return cached;
}

/** 根据 imageCount / includePerImage 返回组图对比评估的 { proposalSchema, arbiterSchema } */
export function getGroupCompareSchemas(imageCount: number, includePerImage: boolean): GroupCompareSchemaSet {
  const key = `${imageCount}:${includePerImage}`;
  let cached = compareCache.get(key);
  if (!cached) {
    cached = createGroupCompareSchemas(imageCount, includePerImage);
    compareCache.set(key, cached);
  }
  return cached;
}
