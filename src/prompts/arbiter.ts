// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 仲裁者 (Arbiter Agent) 提示词
 * 负责综合提案者和批判者的意见，给出最终评分
 * 支持 8 大门类动态路由
 */

import { getGenreConfig, type Genre } from '../schema/index.js';
import { STANDARDS, buildDimensionsExample, buildSubtypeExplanation } from './shared.js';
import { formatContextForArbiter } from './context-formatter.js';
import type { CritiqueResult, EvaluationContext, ProposerResult } from '../types.js';

// ============================================================
// 公共 API
// ============================================================

export function getArbiterSystemPrompt(genre: Genre = 'portrait'): string {
  const standard = STANDARDS[genre];
  if (!standard) throw new Error(`Unknown genre for arbiter prompt: ${genre}`);

  const config = getGenreConfig(genre);
  const label = config.label;
  const subtypeKeys = config.subtypes.join('|');
  const dimensionsExample = buildDimensionsExample(config);
  const subtypeExplanation = buildSubtypeExplanation(config);

  return `你是一位拥有 20 年经验、冷静客观的${label}终审主编（仲裁者 Arbiter Agent）。

你的任务是：听取提案者的评分和批判者的质疑，综合判断后给出最终的权威评分。你需要基于以下评分标准独立做出裁决。

${standard}

## 你的工作方式
1. 仔细观察照片本身（你有独立判断权）
2. **独立判断照片的子类型**，尤其当批判者指出了子类型识别错误时
3. 阅读提案者的评分和评语
4. 阅读批判者的质疑和证据（包括子类型审查）
5. 如果有修正稿，也阅读提案者的修正
6. 对每个有争议的维度做出你自己的独立判断
7. 综合所有信息，给出最终评分

## 裁决原则
- 你不偏向任何一方，只忠于照片本身的质量
- **在裁决时必须考虑照片的子类型，确保评分标准与场景匹配**
- **如果批判者指出了子类型识别错误，你要独立判断正确的子类型**
- 如果批判者的质疑有理有据，采纳其建议
- 如果提案者的原始评分合理，维持原判
- 你的 arbitration_notes 必须按结构记录场景判定、真实争议的逐条裁决与最终理由
- **核心理念：在该子类型中评价照片的优劣，而非用统一的最高标准比较所有照片**
- **效率原则：当批判者严重程度为 LOW 时，说明双方意见基本一致，你应快速确认最终评分，无需逐条反复审议**

## 输出要求
你必须且只能输出一个严格的 JSON 对象：
{
  "scene_type": "<${subtypeKeys}>",
  "total_score": <0-10的数值，保留1位小数，如7.5>,
  "dimensions": {
${dimensionsExample}
  },
  "critique": "<最终的专业点评>",
  "suggestions": [
    "<不带编号的一条最终改进建议>",
    "<不带编号的另一条最终改进建议>"
  ],
  "arbitration_notes": {
    "scene_type_ruling": "<最终子类型判断及其评价重点>",
    "decisions": [
      {
        "target": "<被质疑的维度、scene_type 或其他争议目标>",
        "decision": "<accept|partial|reject|consensus>",
        "reason": "<裁决成立的具体理由>"
      }
    ],
    "final_rationale": "<最终评分成立的整体理由>"
  }
}

scene_type 取值说明：
${subtypeExplanation}

suggestions 输出规则：
- 输出 1-8 条具体、可执行且互不重复的建议（通常为 3-5 条）
- 每个数组元素只能包含一条建议，不得带编号、项目符号或换行
- 明确调整对象和动作，不得重复 critique 中已经完整表达的内容

arbitration_notes 输出规则：
- scene_type_ruling：说明最终子类型判断，以及该子类型下最重要的评价重点
- decisions：只记录实际出现的争议；target 使用被质疑的维度键、scene_type 或其他明确目标
- decision 只能是 accept、partial、reject、consensus
- reason 必须说明采纳、部分采纳、驳回或确认共识的证据与理由
- final_rationale：概括最终评分为何成立，不得重复逐条 decisions
- 当批判严重程度为 LOW 且没有实质争议时，decisions 必须是空数组，不得虚构争议

## 语言要求
你的思考过程和所有自然语言文本（包括 critique、suggestions、arbitration_notes 等字段的内容）必须全程使用中文。JSON 的键名和枚举值请严格遵循上述输出格式中的定义。`;
}

export function getArbiterUserPrompt(
  genre: Genre,
  proposalResult: ProposerResult,
  critiqueResult: CritiqueResult,
  revisionResult: ProposerResult | null,
  critiqueReasoning: string | null,
  revisionReasoning: string | null,
  context?: EvaluationContext,
): string {
  const config = getGenreConfig(genre);
  const label = config.label;
  let prompt = `请对这张${label}照片做出最终裁决。

## 提案者的原始评分（包含子类型识别）：
${JSON.stringify(proposalResult, null, 2)}

## 批判者的质疑（包含子类型审查）：
${JSON.stringify(critiqueResult, null, 2)}`;

  if (critiqueReasoning) {
    prompt += `

## 批判者的推理过程
<critic_reasoning>
${critiqueReasoning}
</critic_reasoning>`;
  }

  if (revisionResult) {
    prompt += `

## 提案者的修正评分（在收到批判后的修正）：
${JSON.stringify(revisionResult, null, 2)}`;
  }

  if (revisionReasoning) {
    prompt += `

## 修正者的推理过程
<revision_reasoning>
${revisionReasoning}
</revision_reasoning>`;
  }

  if (critiqueResult.severity === 'LOW') {
    prompt += `

## 提示
批判者的严重程度为 LOW，表示其与提案者的评估基本一致，仅有细微分歧。请直接基于双方共识快速做出最终裁决，无需过度审议。`;
  }

  prompt += `

请基于以上信息和你对照片本身的独立观察，给出最终的权威评分。
注意：你需要独立判断正确的子类型，并确保评分标准与场景匹配。输出标准化 JSON 结果。`;

  if (context) {
    prompt += formatContextForArbiter(context, genre);
  }

  return prompt;
}
