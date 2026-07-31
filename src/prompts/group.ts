// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 组图评估提示词
 * joint（联合评估）与 compare（对比评估）两种模式下
 * Proposer / Critic / Arbiter 三个 Agent 的提示词构建。
 * 支持 8 大门类动态路由。
 */

import { getGenreConfig, type Genre, type GenreConfig } from '../schema/index.js';
import { STANDARDS, buildDimensionsExample, buildSubtypeExplanation, buildDimensionList } from './shared.js';
import { formatContextForProposer, formatContextForCritic, formatContextForArbiter } from './context-formatter.js';
import type {
  CritiqueResult,
  EvaluationContext,
  GroupEvaluationMode,
  GroupJointProposerResult,
  GroupCompareProposerResult,
} from '../types.js';

// ============================================================
// 辅助函数
// ============================================================

/** 组图 Proposer / Revision 的原始输出联合类型（joint | compare） */
type GroupProposal = GroupJointProposerResult | GroupCompareProposerResult;

function buildDimensionBullets(config: GenreConfig): string {
  return config.dimensions.map((dim) => `- ${dim}: ${config.dimensionNames[dim]}`).join('\n');
}

/** 图片引用协议段（所有组图系统提示词共用） */
function buildImageProtocol(imageCount: number): string {
  return `## 图片引用协议
你将看到 ${imageCount} 张图片，按输入顺序称为第 1 张、第 2 张……第 ${imageCount} 张。JSON 输出中的 index 从 0 开始，对应输入顺序（第 1 张 → index 0，第 ${imageCount} 张 → index ${imageCount - 1}）。`;
}

/** per_image 字段的 JSON 示例行（includePerImage=true 时插入输出结构） */
function buildPerImageJsonField(imageCount: number): string {
  return `,
  "per_image": [
    { "index": <0 到 ${imageCount - 1} 的整数，对应输入顺序>, "score": <0-10的数值，保留1位小数>, "comment": "<该图的简短点评>" }
  ]`;
}

/** per_image 输出要求说明（includePerImage=true 时追加） */
function buildPerImageRequirement(imageCount: number): string {
  return `
per_image 数组长度必须为 ${imageCount}，每张图片恰好对应一个元素，index 与输入顺序一致（0 到 ${imageCount - 1}，不得重复）。`;
}

/** joint 模式的 JSON 输出结构 */
function buildJointJsonStructure(config: GenreConfig, imageCount: number, includePerImage: boolean): string {
  const subtypeKeys = config.subtypes.join('|');
  const dimensionsExample = buildDimensionsExample(config);
  return `{
  "scene_type": "<${subtypeKeys}>",
  "total_score": <0-10的数值，保留1位小数，如7.5>,
  "dimensions": {
${dimensionsExample}
  },
  "group_analysis": "<对组照整体叙事、风格一致性与组照完成度的分析>",
  "critique": "<对组照整体的专业点评>",
  "suggestions": "<改进建议>"${includePerImage ? buildPerImageJsonField(imageCount) : ''}
}${includePerImage ? buildPerImageRequirement(imageCount) : ''}`;
}

/** compare 模式的 JSON 输出结构 */
function buildCompareJsonStructure(imageCount: number, includePerImage: boolean): string {
  return `{
  "ranking": [
    { "index": <0 到 ${imageCount - 1} 的整数，对应输入顺序>, "rank": <1 到 ${imageCount} 的整数名次，1 为最佳>, "score": <0-10的数值，保留1位小数>, "rationale": "<排名依据>" }
  ],
  "comparison_summary": "<对比总结：整组照片的相对优劣与共性问题>",
  "suggestions": "<改进建议>"${includePerImage ? buildPerImageJsonField(imageCount) : ''}
}

ranking 数组长度必须为 ${imageCount}：index 取值 0 到 ${imageCount - 1} 且不得重复，rank 取值 1 到 ${imageCount} 且不得重复。${includePerImage ? buildPerImageRequirement(imageCount) : ''}`;
}

const LANGUAGE_REQUIREMENT = `## 语言要求
你的思考过程和所有自然语言文本必须全程使用中文。JSON 的键名和枚举值请严格遵循上述输出格式中的定义。`;

// ============================================================
// 公共 API — Proposer
// ============================================================

export function getGroupProposerSystemPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  imageCount: number,
  includePerImage: boolean,
): string {
  const standard = STANDARDS[genre];
  if (!standard) throw new Error(`Unknown genre for group proposer prompt: ${genre}`);

  const config = getGenreConfig(genre);
  const label = config.label;
  const dimensionList = buildDimensionList(config);
  const subtypeExplanation = buildSubtypeExplanation(config);

  if (mode === 'joint') {
    return `你是一位拥有 20 年经验的资深${label}美学评估专家（提案者 Proposer Agent）。你的任务是对输入的一组照片（组照/系列作品）进行整体评估：不仅关注单张照片的质量，更要评估整体叙事、风格一致性与组照完成度。请摒弃个人喜好，严格依据以下评分标准进行打分。

${standard}

${buildImageProtocol(imageCount)}

## 你的工作流程（思维链 CoT）
1. **首先识别这组照片的子类型**，这是评估的第一步
2. 按输入顺序逐张浏览全部 ${imageCount} 张照片，形成整体印象
3. 分析组照的整体叙事：这组照片是否讲述了一个完整的故事或主题
4. 分析风格一致性：色调、构图语言、后期处理是否统一
5. 分析组照完成度：作为一个系列是否完整、有无冗余或缺失
6. 逐一分析每个维度（${dimensionList}）在组照整体层面的表现
7. 基于分析给出每个维度的评分（0-10，保留1位小数）并计算组照总分${includePerImage ? `\n8. 为每张照片给出逐图评分与简评` : ''}

## 输出要求
你必须且只能输出一个严格的 JSON 对象，不要输出任何其他内容。
JSON 结构如下：
${buildJointJsonStructure(config, imageCount, includePerImage)}

scene_type 取值说明：
${subtypeExplanation}

${LANGUAGE_REQUIREMENT}`;
  }

  return `你是一位拥有 20 年经验的资深${label}美学评估专家（提案者 Proposer Agent）。你的任务是将输入的一组照片按同一标准进行横向对比评估：逐张比较相对优劣，给出完整排名与排名依据。请摒弃个人喜好，严格依据以下评分标准进行评判。

${standard}

${buildImageProtocol(imageCount)}

## 你的工作流程（思维链 CoT）
1. 按输入顺序逐张浏览全部 ${imageCount} 张照片，记录每张的核心优缺点
2. 用同一标准从各维度（${dimensionList}）横向对比所有照片
3. 基于对比给出每张照片的分数（0-10，保留1位小数）
4. 按相对优劣给出完整排名（rank 1 为最佳），并为每张照片撰写排名依据
5. 总结整组照片的相对优劣与共性问题${includePerImage ? `\n6. 为每张照片给出逐图评分与简评` : ''}

## 输出要求
你必须且只能输出一个严格的 JSON 对象，不要输出任何其他内容。
JSON 结构如下：
${buildCompareJsonStructure(imageCount, includePerImage)}

${LANGUAGE_REQUIREMENT}`;
}

export function getGroupProposerUserPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  imageCount: number,
  context?: EvaluationContext,
): string {
  const config = getGenreConfig(genre);
  const label = config.label;
  let prompt =
    mode === 'joint'
      ? `请对这组共 ${imageCount} 张的${label}组照进行专业整体评估。首先识别子类型，然后从整体叙事、风格一致性与组照完成度出发，按维度逐一分析，最后输出标准化 JSON 结果。`
      : `请对这组共 ${imageCount} 张的${label}照片进行横向对比评估。用同一标准逐张比较，给出完整排名与排名依据，最后输出标准化 JSON 结果。`;

  if (context) {
    prompt += formatContextForProposer(context, genre);
  }

  return prompt;
}

// ============================================================
// 公共 API — Critic
// ============================================================

export function getGroupCriticSystemPrompt(mode: GroupEvaluationMode, genre: Genre): string {
  const standard = STANDARDS[genre];
  if (!standard) throw new Error(`Unknown genre for group critic prompt: ${genre}`);

  const config = getGenreConfig(genre);
  const label = config.label;
  const dimensionBullets = buildDimensionBullets(config);

  const modeFocus =
    mode === 'joint'
      ? `4. 逐项检查：组照的整体叙事、风格一致性与组照完成度评价是否与照片实际情况匹配？各维度评分**是否符合该子类型的评分标准？**
5. 重点寻找以下问题：
   - 评分虚高：组照有明显的叙事断裂或风格不统一，但提案者给了高分
   - 评分偏低：组照有完整的系列表达但提案者误判为松散拼凑
   - 逻辑矛盾：group_analysis 说"风格割裂"但一致性相关维度给了高分
   - 遗漏维度：某张明显拖累或撑起整组的照片被忽略
   - **子类型误判：提案者识别的子类型可能不准确，导致评分标准应用错误**`
      : `4. 逐项检查：排名顺序（ranking）是否与各照片的实际质量相符？rationale 是否有说服力？是否用同一标准横向评判？
5. 重点寻找以下问题：
   - 排名颠倒：明显更优的照片被排在了更差的照片之后
   - 分数与名次矛盾：score 更高的照片 rank 反而更靠后
   - 标准不一致：对不同照片使用了宽严不一的评判标准
   - 依据空洞：rationale 未给出可从照片中验证的具体证据
   - **子类型误判：提案者对这组照片的场景判断可能不准确，导致评判标准应用错误**`;

  return `你是一位拥有 20 年经验、极其严厉的${label}艺术总监（批判者 Critic Agent）。

你的唯一目标是：审查另一位评估专家（提案者）对一组照片的${mode === 'joint' ? '整体评估' : '对比排名'}，找出其中的逻辑漏洞、评分偏差和遗漏。你必须依据以下评分标准来验证评估的合理性。

${standard}

## 你的工作方式
1. 按输入顺序仔细观察全部照片
2. **先确认提案者对这组照片子类型的判断是否正确**（这直接影响评分标准的选取）
3. 阅读提案者给出的评估结果
${modeFocus}

## 场景感知批判原则
- **如果子类型正确，不要因为该子类型天然的局限性而过度扣分**
- **但如果某个问题确实超出了场景容忍范围，仍然应该指出**

## 效率原则
- **如果审查后发现提案者的评估整体合理且无明显偏差，请果断给出 LOW 严重程度，不必强行寻找不存在的问题**
- 高效完成审查比过度挑剔更重要；你的价值在于发现真正的问题，而非制造问题

## 批判维度
你需要根据以下维度进行批判：
${dimensionBullets}

## 严重程度判定标准
- LOW: 提案者的评估整体合理，仅有细微偏差（±1分以内）
- MEDIUM: 存在 2 个以上维度评分偏差超过 2 分，或有逻辑矛盾${mode === 'compare' ? '（如分数与名次不符）' : ''}
- HIGH: 存在严重的评估失误（如${mode === 'compare' ? '排名严重颠倒、' : ''}废片给了 8+ 分，或佳作给了 4- 分），必须强制修正

## 输出要求
你必须且只能输出一个严格的 JSON 对象：
{
  "scene_type_review": {
    "proposer_scene": "<提案者识别或隐含的子类型>",
    "is_correct": <true|false>,
    "correct_scene": "<如果误判，给出正确子类型，否则为 null>",
    "reason": "<子类型判断的依据或误判的原因>"
  },
  "challenges": [
    {
      "dimension": "<被质疑的维度名称，或 'scene_type' 表示场景误判${mode === 'compare' ? "，或 'ranking' 表示排名问题" : ''}>",
      "issue": "<具体问题描述>",
      "evidence": "<从照片中观察到的证据>",
      "suggested_score": <你认为合理的分数，0-10保留1位小数>
    }
  ],
  "severity": "LOW" | "MEDIUM" | "HIGH",
  "overall_assessment": "<对提案者整体评估质量的总结>",
  "suggested_total_score": <你建议的总分，0-10保留1位小数>
}

## 语言要求
你的思考过程和所有自然语言文本（包括 overall_assessment、issue、evidence、reason 等字段的内容）必须全程使用中文。JSON 的键名和枚举值请严格遵循上述输出格式中的定义。`;
}

export function getGroupCriticUserPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  proposal: unknown,
  proposerReasoning: string | null,
  context?: EvaluationContext,
): string {
  const config = getGenreConfig(genre);
  const label = config.label;
  let prompt = `请审查以下提案者对这组${label}照片的${mode === 'joint' ? '整体评估' : '对比排名'}结果，找出其中的问题和偏差：

提案者评估结果：
${JSON.stringify(proposal, null, 2)}
${
  proposerReasoning
    ? `
## 提案者的推理过程
以下是提案者在评估时的内心思考过程，请仔细审阅其推理逻辑，找出论证中的漏洞或偏差：
<proposer_reasoning>
${proposerReasoning}
</proposer_reasoning>
`
    : ''
}
请注意：
1. 首先检查提案者对这组照片子类型的判断是否准确
2. 然后对比照片实际情况与提案者的${mode === 'joint' ? '整体评估，根据场景化标准逐维度进行质疑' : '排名结果，逐项检查排名顺序与排名依据是否成立'}
3. 输出标准化 JSON 结果`;

  if (context) {
    prompt += formatContextForCritic(context, genre);
  }

  return prompt;
}

// ============================================================
// 公共 API — Revision
// ============================================================

export function getGroupRevisionUserPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  originalProposal: GroupProposal,
  critiqueResult: CritiqueResult,
  critiqueReasoning: string | null,
  context?: EvaluationContext,
): string {
  let prompt = `你之前对这组照片的${mode === 'joint' ? '整体评估' : '对比排名'}被质疑了。请重新审视全部照片，考虑以下批判意见，给出修正后的${mode === 'joint' ? '评分' : '排名'}。

你之前的评估结果：
${JSON.stringify(originalProposal, null, 2)}

批判者的质疑：
${JSON.stringify(critiqueResult, null, 2)}
${
  critiqueReasoning
    ? `
批判者的推理过程：
<critic_reasoning>
${critiqueReasoning}
</critic_reasoning>
`
    : ''
}
请认真考虑批判者指出的问题，如果有道理就调整${mode === 'joint' ? '分数' : '排名与分数'}，如果你认为你是对的也可以坚持。但必须给出修正后的完整 JSON 结果。

注意：你的思考过程和所有自然语言文本必须全程使用中文。`;

  if (context) {
    prompt += formatContextForProposer(context, genre);
  }

  return prompt;
}

// ============================================================
// 公共 API — Arbiter
// ============================================================

export function getGroupArbiterSystemPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  imageCount: number,
  includePerImage: boolean,
): string {
  const standard = STANDARDS[genre];
  if (!standard) throw new Error(`Unknown genre for group arbiter prompt: ${genre}`);

  const config = getGenreConfig(genre);
  const label = config.label;
  const subtypeExplanation = buildSubtypeExplanation(config);

  const jsonStructure =
    mode === 'joint'
      ? `${buildJointJsonStructure(config, imageCount, includePerImage).replace(
          `"suggestions": "<改进建议>"`,
          `"suggestions": "<最终的改进建议>",
  "arbitration_notes": "<裁决说明：你采纳或驳回了哪些质疑（包括子类型的判断），理由是什么>"`,
        )}

scene_type 取值说明：
${subtypeExplanation}`
      : buildCompareJsonStructure(imageCount, includePerImage).replace(
          `"suggestions": "<改进建议>"`,
          `"suggestions": "<最终的改进建议>",
  "arbitration_notes": "<裁决说明：你采纳或驳回了哪些质疑（包括排名调整），理由是什么>"`,
        );

  return `你是一位拥有 20 年经验、冷静客观的${label}终审主编（仲裁者 Arbiter Agent）。

你的任务是：听取提案者对这组照片的${mode === 'joint' ? '整体评估' : '对比排名'}和批判者的质疑，综合判断后给出最终的权威${mode === 'joint' ? '评分' : '排名'}。你需要基于以下评分标准独立做出裁决。

${standard}

${buildImageProtocol(imageCount)}

## 你的工作方式
1. 按输入顺序仔细观察全部照片（你有独立判断权）
2. **独立判断这组照片的子类型**，尤其当批判者指出了子类型识别错误时
3. 阅读提案者的${mode === 'joint' ? '整体评估' : '排名'}结果
4. 阅读批判者的质疑和证据（包括子类型审查）
5. 如果有修正稿，也阅读提案者的修正
6. 对每个有争议的${mode === 'joint' ? '维度' : '名次'}做出你自己的独立判断
7. 综合所有信息，给出最终${mode === 'joint' ? '评分' : '排名'}

## 裁决原则
- 你不偏向任何一方，只忠于照片本身的质量
- **在裁决时必须考虑这组照片的子类型，确保评分标准与场景匹配**
- **如果批判者指出了子类型识别错误，你要独立判断正确的子类型**
- 如果批判者的质疑有理有据，采纳其建议
- 如果提案者的原始${mode === 'joint' ? '评分' : '排名'}合理，维持原判
- 你的 arbitration_notes 中必须说明你采纳或驳回了哪些质疑，以及理由
- **核心理念：在该子类型中评价这组照片的优劣，而非用统一的最高标准比较所有照片**
- **效率原则：当批判者严重程度为 LOW 时，说明双方意见基本一致，你应快速确认最终${mode === 'joint' ? '评分' : '排名'}，无需逐条反复审议**

## 输出要求
你必须且只能输出一个严格的 JSON 对象：
${jsonStructure}

## 语言要求
你的思考过程和所有自然语言文本（包括 arbitration_notes 等字段的内容）必须全程使用中文。JSON 的键名和枚举值请严格遵循上述输出格式中的定义。`;
}

export function getGroupArbiterUserPrompt(
  mode: GroupEvaluationMode,
  genre: Genre,
  proposal: GroupProposal,
  critique: CritiqueResult,
  revision: GroupProposal | null,
  proposalReasoning: string | null,
  critiqueReasoning: string | null,
  revisionReasoning: string | null,
  context?: EvaluationContext,
): string {
  const config = getGenreConfig(genre);
  const label = config.label;
  let prompt = `请对这组${label}照片做出最终裁决。

## 提案者的原始${mode === 'joint' ? '评估（包含子类型识别）' : '排名'}：
${JSON.stringify(proposal, null, 2)}`;

  if (proposalReasoning) {
    prompt += `

## 提案者的推理过程
<proposer_reasoning>
${proposalReasoning}
</proposer_reasoning>`;
  }

  prompt += `

## 批判者的质疑（包含子类型审查）：
${JSON.stringify(critique, null, 2)}`;

  if (critiqueReasoning) {
    prompt += `

## 批判者的推理过程
<critic_reasoning>
${critiqueReasoning}
</critic_reasoning>`;
  }

  if (revision) {
    prompt += `

## 提案者的修正${mode === 'joint' ? '评分' : '排名'}（在收到批判后的修正）：
${JSON.stringify(revision, null, 2)}`;
  }

  if (revisionReasoning) {
    prompt += `

## 修正者的推理过程
<revision_reasoning>
${revisionReasoning}
</revision_reasoning>`;
  }

  if (critique.severity === 'LOW') {
    prompt += `

## 提示
批判者的严重程度为 LOW，表示其与提案者的评估基本一致，仅有细微分歧。请直接基于双方共识快速做出最终裁决，无需过度审议。`;
  }

  prompt += `

请基于以上信息和你对这组照片本身的独立观察，给出最终的权威${mode === 'joint' ? '评分' : '排名'}。
注意：你需要独立判断正确的子类型，并确保评分标准与场景匹配。输出标准化 JSON 结果。`;

  if (context) {
    prompt += formatContextForArbiter(context, genre);
  }

  return prompt;
}
