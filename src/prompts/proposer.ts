// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 提案者 (Proposer Agent) 提示词
 * 负责对照片进行初始评估
 * 支持 8 大门类动态路由
 */

import { getGenreConfig, type Genre } from '../schema/index.js';
import { STANDARDS, buildDimensionsExample, buildSubtypeExplanation, buildDimensionList } from './shared.js';
import { formatContextForProposer } from './context-formatter.js';
import type { CritiqueResult, EvaluationContext, ProposerResult } from '../types.js';

// ============================================================
// 公共 API
// ============================================================

export function getProposerSystemPrompt(genre: Genre = 'portrait'): string {
  const standard = STANDARDS[genre];
  if (!standard) throw new Error(`Unknown genre for proposer prompt: ${genre}`);

  const config = getGenreConfig(genre);
  const label = config.label;
  const subtypeKeys = config.subtypes.join('|');
  const dimensionList = buildDimensionList(config);
  const dimensionsExample = buildDimensionsExample(config);
  const subtypeExplanation = buildSubtypeExplanation(config);

  return `你是一位拥有 20 年经验的资深${label}美学评估专家（提案者 Proposer Agent）。你的任务是对输入的照片进行客观、专业且多维度的美学评估。请摒弃个人喜好，严格依据以下评分标准进行打分。

${standard}

## 你的工作流程（思维链 CoT）
1. **首先识别照片的子类型**，这是评估的第一步
2. 根据子类型确定各维度的权重偏好和评分期望
3. 仔细观察照片的整体印象
4. 逐一分析每个维度（${dimensionList}），**根据场景化标准评判**
5. 记录每个维度的优缺点
6. 基于分析给出每个维度的评分（0-10，保留1位小数）
7. 计算总分（根据场景化权重加权平均，或基于整体印象微调）
8. 撰写简洁专业的点评和改进建议

## 输出要求
你必须且只能输出一个严格的 JSON 对象，不要输出任何其他内容。
JSON 结构如下：
{
  "scene_type": "<${subtypeKeys}>",
  "total_score": <0-10的数值，保留1位小数，如7.5>,
  "dimensions": {
${dimensionsExample}
  },
  "critique": "<50字以内的专业点评>",
  "suggestions": "<改进建议>"
}

scene_type 取值说明：
${subtypeExplanation}

## 语言要求
你的思考过程和所有自然语言文本（包括 critique、suggestions 等字段的内容）必须全程使用中文。JSON 的键名和枚举值请严格遵循上述输出格式中的定义。`;
}

export function getProposerUserPrompt(genre: Genre = 'portrait', context?: EvaluationContext): string {
  const config = getGenreConfig(genre);
  const label = config.label;
  const dimensionCount = config.dimensions.length;
  let prompt = `请对这张${label}照片进行专业美学评估。首先识别子类型，然后根据场景化标准，严格按照${dimensionCount}个维度逐一分析，最后输出标准化 JSON 结果。`;

  if (context) {
    prompt += formatContextForProposer(context, genre);
  }

  return prompt;
}

export function getRevisionUserPrompt(
  genre: Genre,
  originalProposal: ProposerResult,
  critiqueResult: CritiqueResult,
  critiqueThinking: string | null,
  context?: EvaluationContext,
): string {
  let prompt = `你之前对这张照片的评估被质疑了。请重新审视照片，考虑以下批判意见，给出修正后的评分。

你之前的评分：
${JSON.stringify(originalProposal, null, 2)}

批判者的质疑：
${JSON.stringify(critiqueResult, null, 2)}
${
  critiqueThinking
    ? `
批判者的推理过程：
<critic_thinking>
${critiqueThinking}
</critic_thinking>
`
    : ''
}
请认真考虑批判者指出的问题，如果有道理就调整分数，如果你认为你是对的也可以坚持。但必须给出修正后的完整 JSON 结果。`;

  if (context) {
    prompt += formatContextForProposer(context, genre);
  }

  return prompt;
}
