// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 提示词共享模块
 * 提供门类映射、评分标准注册表和维度构建辅助函数，
 * 供 proposer / critic / arbiter 三个 Agent 共用。
 */

import { SCORING_STANDARD as PORTRAIT_STANDARD } from './standards/portrait.js';
import { SCORING_STANDARD as LANDSCAPE_STANDARD } from './standards/landscape.js';
import { SCORING_STANDARD as DOCUMENTARY_STANDARD } from './standards/documentary.js';
import { SCORING_STANDARD as FINE_ART_STANDARD } from './standards/fine_art.js';
import { SCORING_STANDARD as COMMERCIAL_STANDARD } from './standards/commercial.js';
import { SCORING_STANDARD as ARCHITECTURE_STANDARD } from './standards/architecture.js';
import { SCORING_STANDARD as NATURE_STANDARD } from './standards/nature.js';
import { SCORING_STANDARD as SPORTS_STANDARD } from './standards/sports.js';
import { type Genre, type GenreConfig } from '../schema/index.js';

// ============================================================
// 门类 → 评分标准 注册表
// ============================================================
export const STANDARDS: Record<Genre, string> = {
  portrait: PORTRAIT_STANDARD,
  landscape: LANDSCAPE_STANDARD,
  documentary: DOCUMENTARY_STANDARD,
  fine_art: FINE_ART_STANDARD,
  commercial: COMMERCIAL_STANDARD,
  architecture: ARCHITECTURE_STANDARD,
  nature: NATURE_STANDARD,
  sports: SPORTS_STANDARD,
};

// ============================================================
// 维度构建辅助函数
// ============================================================

/** 动态生成 JSON 维度字段示例 */
export function buildDimensionsExample(config: GenreConfig): string {
  return config.dimensions.map((dim) => `    "${dim}": <0-10的数值，保留1位小数>`).join(',\n');
}

/** 动态生成子类型取值说明 */
export function buildSubtypeExplanation(config: GenreConfig): string {
  return Object.entries(config.subtypeNames)
    .map(([key, label]) => `- ${key}: ${label}`)
    .join('\n');
}

/** 动态生成维度中文列表（用于思维链描述） */
export function buildDimensionList(config: GenreConfig): string {
  return config.dimensions.map((dim) => `${config.dimensionNames[dim]}`).join('、');
}
