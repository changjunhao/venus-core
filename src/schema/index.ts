// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { z } from 'zod';

/** Genre configuration metadata */
export interface GenreConfig {
  label: string;
  dimensionLabels: string[];
  subtypes: string[];
  dimensions: string[];
  dimensionNames: Record<string, string>;
  subtypeNames: Record<string, string>;
}

/** Genre metadata for external consumers */
export interface GenreMetadata {
  label: string;
  dimensionLabels: string[];
  subtypes: Array<{ value: string; label: string }>;
  dimensions: Array<{ key: string; label: string }>;
}

// ============================================================
// 1. GenreEnum — 8 大门类
// ============================================================
export const GenreEnum: z.ZodType<Genre> = z.enum([
  'portrait',
  'landscape',
  'documentary',
  'fine_art',
  'commercial',
  'architecture',
  'nature',
  'sports',
]);

/** 门类键名联合类型 */
export type Genre =
  | 'portrait'
  | 'landscape'
  | 'documentary'
  | 'fine_art'
  | 'commercial'
  | 'architecture'
  | 'nature'
  | 'sports';

/** 从 GENRE_CONFIG 推导的精确子类型（如 portrait → "studio" | "environmental" | "wedding"） */
export type SubtypeForGenre<G extends Genre = Genre> = G extends 'portrait'
  ? 'studio' | 'environmental' | 'wedding'
  : G extends 'landscape'
    ? 'natural' | 'urban' | 'seascape' | 'astro'
    : G extends 'documentary'
      ? 'news' | 'street' | 'social'
      : G extends 'fine_art'
        ? 'conceptual' | 'abstract' | 'experimental'
        : G extends 'commercial'
          ? 'product' | 'fashion'
          : G extends 'architecture'
            ? 'interior' | 'exterior'
            : G extends 'nature'
              ? 'wildlife' | 'flora' | 'macro'
              : G extends 'sports'
                ? 'action' | 'extreme'
                : string;

/** 从 GENRE_CONFIG 推导的精确维度键名（如 portrait → "facial_expression" | "pose_body" | ...） */
export type DimensionForGenre<G extends Genre = Genre> = G extends 'portrait'
  ? 'facial_expression' | 'pose_body' | 'lighting_quality' | 'color_mood' | 'composition_focus'
  : G extends 'landscape'
    ? 'composition_depth' | 'light_atmosphere' | 'color_harmony' | 'sharpness_detail' | 'emotional_resonance'
    : G extends 'documentary'
      ? 'storytelling' | 'decisive_moment' | 'composition_angle' | 'authenticity' | 'emotional_impact'
      : G extends 'fine_art'
        ? 'conceptual_depth' | 'visual_language' | 'technical_craft' | 'originality' | 'aesthetic_impact'
        : G extends 'commercial'
          ? 'subject_presentation' | 'lighting_technique' | 'styling_composition' | 'color_branding' | 'market_appeal'
          : G extends 'architecture'
            ?
                | 'perspective_geometry'
                | 'spatial_expression'
                | 'light_material'
                | 'contextual_harmony'
                | 'architectural_narrative'
            : G extends 'nature'
              ? 'subject_capture' | 'focus_sharpness' | 'habitat_context' | 'technical_mastery' | 'natural_wonder'
              : G extends 'sports'
                ? 'peak_action' | 'timing_precision' | 'framing_tracking' | 'technical_execution' | 'drama_narrative'
                : string;

// ============================================================
// 2. GENRE_CONFIG — 核心配置注册表
// 使用 as const satisfies 保留字面量类型，以便从 GENRE_CONFIG 推导精确的
// 门类相关类型（SubtypeForGenre、DimensionForGenre 等）
// ============================================================
const GENRE_CONFIG = {
  portrait: {
    label: '人像摄影',
    dimensionLabels: ['神态', '姿态', '光影', '色彩', '构图'],
    subtypes: ['studio', 'environmental', 'wedding'],
    dimensions: ['facial_expression', 'pose_body', 'lighting_quality', 'color_mood', 'composition_focus'],
    dimensionNames: {
      facial_expression: '面部神态',
      pose_body: '姿态与体态',
      lighting_quality: '光影品质',
      color_mood: '色彩与氛围',
      composition_focus: '构图与焦点',
    },
    subtypeNames: {
      studio: '棚拍/写真',
      environmental: '环境人像/旅拍',
      wedding: '婚礼',
    },
  },
  landscape: {
    label: '风光摄影',
    dimensionLabels: ['构图纵深', '光线气氛', '色彩和谐', '锐度细节', '情感共鸣'],
    subtypes: ['natural', 'urban', 'seascape', 'astro'],
    dimensions: ['composition_depth', 'light_atmosphere', 'color_harmony', 'sharpness_detail', 'emotional_resonance'],
    dimensionNames: {
      composition_depth: '构图与纵深',
      light_atmosphere: '光线与气氛',
      color_harmony: '色彩和谐',
      sharpness_detail: '锐度与细节',
      emotional_resonance: '情感共鸣',
    },
    subtypeNames: {
      natural: '自然风光',
      urban: '城市风光',
      seascape: '海景',
      astro: '星空/天文',
    },
  },
  documentary: {
    label: '纪实摄影',
    dimensionLabels: ['叙事', '瞬间', '构图', '真实', '情感'],
    subtypes: ['news', 'street', 'social'],
    dimensions: ['storytelling', 'decisive_moment', 'composition_angle', 'authenticity', 'emotional_impact'],
    dimensionNames: {
      storytelling: '叙事能力',
      decisive_moment: '决定性瞬间',
      composition_angle: '构图与视角',
      authenticity: '真实性',
      emotional_impact: '情感冲击',
    },
    subtypeNames: {
      news: '新闻纪实',
      street: '街头摄影',
      social: '社会纪实',
    },
  },
  fine_art: {
    label: '艺术摄影',
    dimensionLabels: ['概念', '视觉', '工艺', '原创', '美学'],
    subtypes: ['conceptual', 'abstract', 'experimental'],
    dimensions: ['conceptual_depth', 'visual_language', 'technical_craft', 'originality', 'aesthetic_impact'],
    dimensionNames: {
      conceptual_depth: '概念深度',
      visual_language: '视觉语言',
      technical_craft: '技术工艺',
      originality: '原创性',
      aesthetic_impact: '美学冲击',
    },
    subtypeNames: {
      conceptual: '观念摄影',
      abstract: '抽象摄影',
      experimental: '实验摄影',
    },
  },
  commercial: {
    label: '商业摄影',
    dimensionLabels: ['主体', '布光', '造型', '色彩', '市场'],
    subtypes: ['product', 'fashion'],
    dimensions: [
      'subject_presentation',
      'lighting_technique',
      'styling_composition',
      'color_branding',
      'market_appeal',
    ],
    dimensionNames: {
      subject_presentation: '主体呈现',
      lighting_technique: '布光技术',
      styling_composition: '造型与构图',
      color_branding: '色彩调性',
      market_appeal: '市场吸引力',
    },
    subtypeNames: {
      product: '产品摄影',
      fashion: '时尚摄影',
    },
  },
  architecture: {
    label: '建筑摄影',
    dimensionLabels: ['透视', '空间', '光材', '环境', '叙事'],
    subtypes: ['interior', 'exterior'],
    dimensions: [
      'perspective_geometry',
      'spatial_expression',
      'light_material',
      'contextual_harmony',
      'architectural_narrative',
    ],
    dimensionNames: {
      perspective_geometry: '透视与几何',
      spatial_expression: '空间表达',
      light_material: '光线与材质',
      contextual_harmony: '环境融合',
      architectural_narrative: '建筑叙事',
    },
    subtypeNames: {
      interior: '室内建筑',
      exterior: '室外建筑',
    },
  },
  nature: {
    label: '自然摄影',
    dimensionLabels: ['捕捉', '对焦', '环境', '技术', '自然美'],
    subtypes: ['wildlife', 'flora', 'macro'],
    dimensions: ['subject_capture', 'focus_sharpness', 'habitat_context', 'technical_mastery', 'natural_wonder'],
    dimensionNames: {
      subject_capture: '主体捕捉',
      focus_sharpness: '对焦与锐度',
      habitat_context: '栖息环境',
      technical_mastery: '技术掌控',
      natural_wonder: '自然之美',
    },
    subtypeNames: {
      wildlife: '野生动物',
      flora: '植物',
      macro: '微距',
    },
  },
  sports: {
    label: '体育摄影',
    dimensionLabels: ['动作', '时机', '取景', '执行', '戏剧'],
    subtypes: ['action', 'extreme'],
    dimensions: ['peak_action', 'timing_precision', 'framing_tracking', 'technical_execution', 'drama_narrative'],
    dimensionNames: {
      peak_action: '巅峰动作',
      timing_precision: '时机精准',
      framing_tracking: '取景与追踪',
      technical_execution: '技术执行',
      drama_narrative: '戏剧与叙事',
    },
    subtypeNames: {
      action: '竞技运动',
      extreme: '极限运动',
    },
  },
} as const satisfies Record<Genre, GenreConfig>;

// ============================================================
// 3. 评分字段辅助
// ============================================================
const scoreField = (): z.ZodNumber => z.number().min(0).max(10).multipleOf(0.1);

// ============================================================
// 4. 子类型枚举注册表（缓存）
// ============================================================
const subtypeEnumCache: Record<string, z.ZodType<string>> = {};

function getSubtypeEnum(genre: Genre): z.ZodType<string> {
  if (!subtypeEnumCache[genre]) {
    const cfg = GENRE_CONFIG[genre];
    if (!cfg) throw new Error(`Unknown genre: ${genre}`);
    subtypeEnumCache[genre] = z.enum(cfg.subtypes as [string, ...string[]]);
  }
  return subtypeEnumCache[genre]!;
}

// ============================================================
// 5. 工厂函数 — 动态创建 Schema
// ============================================================

function buildDimensionsSchema(genre: Genre) {
  const cfg = GENRE_CONFIG[genre];
  if (!cfg) throw new Error(`Unknown genre: ${genre}`);
  const shape: Record<string, z.ZodNumber> = {};
  for (const dim of cfg.dimensions) {
    shape[dim] = scoreField();
  }
  return z.object(shape);
}

/** 创建 Proposal Schema */
function createProposalSchema(genre: Genre): z.ZodType<{
  scene_type: string;
  total_score: number;
  dimensions: Record<string, number>;
  critique: string;
  suggestions: string;
}> {
  return z.object({
    scene_type: getSubtypeEnum(genre),
    total_score: scoreField(),
    dimensions: buildDimensionsSchema(genre),
    critique: z.string().min(1),
    suggestions: z.string().min(1),
  });
}

/** 创建 Arbiter Schema（基于 Proposal 扩展 arbitration_notes） */
function createArbiterSchema(genre: Genre): z.ZodType<{
  scene_type: string;
  total_score: number;
  dimensions: Record<string, number>;
  critique: string;
  suggestions: string;
  arbitration_notes: string;
}> {
  return z.object({
    scene_type: getSubtypeEnum(genre),
    total_score: scoreField(),
    dimensions: buildDimensionsSchema(genre),
    critique: z.string().min(1),
    suggestions: z.string().min(1),
    arbitration_notes: z.string().min(1),
  });
}

// ============================================================
// 6. CritiqueSchema — 通用
// ============================================================
export const CritiqueSchema: z.ZodType<CritiqueResult> = z.object({
  scene_type_review: z.object({
    proposer_scene: z.string(),
    is_correct: z.boolean(),
    correct_scene: z.string().nullable(),
    reason: z.string(),
  }),
  challenges: z.array(
    z.object({
      dimension: z.string(),
      issue: z.string(),
      evidence: z.string(),
      suggested_score: scoreField(),
    }),
  ),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  overall_assessment: z.string(),
  suggested_total_score: scoreField(),
});

/** 批判结果类型 */
export interface CritiqueResult {
  scene_type_review: SceneTypeReview;
  challenges: CritiqueChallenge[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  overall_assessment: string;
  suggested_total_score: number;
}

/** 批判挑战项 */
export interface CritiqueChallenge {
  dimension: string;
  issue: string;
  evidence: string;
  suggested_score: number;
}

/** 场景类型审查 */
export interface SceneTypeReview {
  proposer_scene: string;
  is_correct: boolean;
  correct_scene: string | null;
  reason: string;
}

// ============================================================
// 7. Schema 缓存 — 类型由工厂函数 ReturnType 自动推断
// ============================================================
const proposalCache: Record<string, ReturnType<typeof createProposalSchema>> = {};
const arbiterCache: Record<string, ReturnType<typeof createArbiterSchema>> = {};
const assessmentCache: Record<string, ReturnType<typeof buildProposerResultSchema>> = {};

// ============================================================
// 8. 公共 API
// ============================================================

/** 根据 genre 返回 { proposalSchema, critiqueSchema, arbiterSchema } */
export function getSchemas(genre: Genre): {
  proposalSchema: ReturnType<typeof createProposalSchema>;
  critiqueSchema: typeof CritiqueSchema;
  arbiterSchema: ReturnType<typeof createArbiterSchema>;
} {
  if (!proposalCache[genre]) {
    proposalCache[genre] = createProposalSchema(genre);
  }
  if (!arbiterCache[genre]) {
    arbiterCache[genre] = createArbiterSchema(genre);
  }
  return {
    proposalSchema: proposalCache[genre]!,
    critiqueSchema: CritiqueSchema,
    arbiterSchema: arbiterCache[genre]!,
  };
}

/** 返回完整评估结果 Schema */
export function getProposerResultSchema(genre: Genre) {
  if (!assessmentCache[genre]) {
    assessmentCache[genre] = buildProposerResultSchema(genre);
  }
  return assessmentCache[genre]!;
}

/** 返回门类配置 */
export function getGenreConfig(genre: Genre): GenreConfig {
  const cfg = GENRE_CONFIG[genre];
  if (!cfg) throw new Error(`Unknown genre: ${genre}`);
  return {
    label: cfg.label,
    dimensionLabels: [...cfg.dimensionLabels],
    subtypes: [...cfg.subtypes],
    dimensions: [...cfg.dimensions],
    dimensionNames: { ...cfg.dimensionNames },
    subtypeNames: { ...cfg.subtypeNames },
  };
}

/** 返回所有已注册门类列表 */
export function getAllGenres(): string[] {
  return Object.keys(GENRE_CONFIG);
}

/** 返回所有门类的元数据摘要 */
export function getMetadata(): Record<string, GenreMetadata> {
  const result: Record<string, GenreMetadata> = {};
  for (const [key, config] of Object.entries(GENRE_CONFIG) as [Genre, GenreConfig][]) {
    result[key] = {
      label: config.label,
      dimensionLabels: [...config.dimensionLabels],
      subtypes: config.subtypes.map((s) => ({ value: s, label: config.subtypeNames[s] ?? s })),
      dimensions: config.dimensions.map((d) => ({ key: d, label: config.dimensionNames[d] ?? d })),
    };
  }
  return result;
}

// ============================================================
// 内部：构建 ProposerResultSchema
// ============================================================
function buildProposerResultSchema(genre: Genre) {
  const proposal = proposalCache[genre] ?? createProposalSchema(genre);
  const arbiter = arbiterCache[genre] ?? createArbiterSchema(genre);

  // 缓存填充
  if (!proposalCache[genre]) proposalCache[genre] = proposal;
  if (!arbiterCache[genre]) arbiterCache[genre] = arbiter;

  // AgentCallResult 包装: { result: T, reasoning: string | null }
  const agentCallResult = (schema: z.ZodTypeAny) => z.object({ result: schema, reasoning: z.string().nullable() });

  const genreDetectionResult = z.object({ genre: GenreEnum, confidence: z.number().min(0).max(1) });

  return z.object({
    // 顶层字段 — camelCase，匹配 EvaluationResult 类型
    imageUrl: z.string(),
    genre: z.literal(genre),
    sceneType: getSubtypeEnum(genre),
    totalScore: scoreField(),
    dimensions: buildDimensionsSchema(genre),
    critique: z.string(),
    suggestions: z.string(),
    arbitrationNotes: z.string(),
    // process 内嵌套保持 snake_case（agent 原始输出）
    process: z.object({
      genreDetection: agentCallResult(genreDetectionResult).optional(),
      proposal: agentCallResult(proposal),
      critique: agentCallResult(CritiqueSchema),
      revision: agentCallResult(proposal).optional(),
      arbitration: agentCallResult(arbiter),
    }),
    metadata: z.object({
      evaluatedAt: z.string(),
      durationMs: z.number(),
      rounds: z.union([z.literal(3), z.literal(4)]),
    }),
  });
}

// ============================================================
// 9. EXIF 数据 Schema
// ============================================================
export const ExifDataSchema: z.ZodType<ExifData> = z.object({
  shutterSpeed: z.string().nullable().optional(),
  iso: z.number().nullable().optional(),
  fNumber: z.number().nullable().optional(),
  focalLength: z.number().nullable().optional(),
  cameraModel: z.string().nullable().optional(),
  lensModel: z.string().nullable().optional(),
  dateTimeOriginal: z.string().nullable().optional(),
  flash: z.string().nullable().optional(),
});

/** EXIF 元数据类型 */
export interface ExifData {
  shutterSpeed?: string | null;
  iso?: number | null;
  fNumber?: number | null;
  focalLength?: number | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  dateTimeOriginal?: string | null;
  flash?: string | null;
}

// ============================================================
// 10. 评估上下文 Schema
// ============================================================
export const EvaluationContextSchema: z.ZodType<EvaluationContext> = z.object({
  /** 门类检测器的推理链输出（引擎内部注入，用于传播到 Proposer） */
  genreDetectionReasoning: z.string().nullable().optional(),
  exif: ExifDataSchema.optional(),
  userNotes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

/** 评估上下文类型 */
export interface EvaluationContext {
  /** 门类检测器的推理链输出（引擎内部注入，用于传播到 Proposer） */
  genreDetectionReasoning?: string | null;
  exif?: ExifData;
  userNotes?: string;
  custom?: Record<string, unknown>;
}
