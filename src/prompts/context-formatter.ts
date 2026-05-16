// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 上下文格式化工具
 * 将 EvaluationContext（含 EXIF）格式化为适合不同 Agent 的 Prompt 文本块
 * 按门类差异化注入强度
 */

import type { EvaluationContext, ExifData, Genre } from '../types.js';

// ============================================================
// EXIF 注入权重等级
// ============================================================

type ExifInjectionLevel = 'high' | 'standard' | 'light' | 'minimal';

/**
 * 门类 → EXIF 注入权重
 * sports/nature: 'high' — 快门/焦距对评分有直接参考价值
 * landscape/portrait: 'standard' — 光圈/焦距等常规参考
 * architecture/commercial/documentary: 'light' — 仅展示，不强调
 * fine_art: 'minimal' — 明确提示仅供参考
 */
function getExifInjectionLevel(genre: Genre): ExifInjectionLevel {
  switch (genre) {
    case 'sports':
    case 'nature':
      return 'high';
    case 'landscape':
    case 'portrait':
      return 'standard';
    case 'architecture':
    case 'commercial':
    case 'documentary':
      return 'light';
    case 'fine_art':
      return 'minimal';
    default:
      return 'standard';
  }
}

// ============================================================
// EXIF 文本构建辅助
// ============================================================

/** 将 EXIF 字段组装为可读的参数列表 */
function buildExifLines(exif: ExifData): string[] {
  const lines: string[] = [];
  if (exif.shutterSpeed) lines.push(`快门速度：${exif.shutterSpeed}s`);
  if (exif.fNumber != null) lines.push(`光圈：f/${exif.fNumber}`);
  if (exif.iso != null) lines.push(`ISO：${exif.iso}`);
  if (exif.focalLength != null) lines.push(`焦距：${exif.focalLength}mm`);
  if (exif.cameraModel) lines.push(`机身：${exif.cameraModel}`);
  if (exif.lensModel) lines.push(`镜头：${exif.lensModel}`);
  if (exif.dateTimeOriginal) lines.push(`拍摄时间：${exif.dateTimeOriginal}`);
  if (exif.flash) lines.push(`闪光灯：${exif.flash}`);
  return lines;
}

/** 构建简短的 EXIF 摘要（一行式） */
function buildExifSummary(exif: ExifData): string {
  const parts: string[] = [];
  if (exif.shutterSpeed) parts.push(`快门 ${exif.shutterSpeed}s`);
  if (exif.fNumber != null) parts.push(`光圈 f/${exif.fNumber}`);
  if (exif.iso != null) parts.push(`ISO ${exif.iso}`);
  if (exif.focalLength != null) parts.push(`焦距 ${exif.focalLength}mm`);
  return parts.join('、');
}

const EXIF_DISCLAIMER = '注意：EXIF 数据可能经后期修改，请以照片实际视觉效果为最终评判依据。';

// ============================================================
// 门类差异化 EXIF 格式化
// ============================================================

function formatExifBlock(exif: ExifData, genre: Genre): string {
  const level = getExifInjectionLevel(genre);
  const lines = buildExifLines(exif);

  if (lines.length === 0) return '';

  switch (level) {
    case 'high': {
      // 强调注入 — 快门/焦距对评分有直接参考价值
      const genreHint =
        genre === 'sports'
          ? `体育摄影中快门速度${exif.shutterSpeed ? ` ${exif.shutterSpeed}s` : ''}表明拍摄者意图冻结动作，${exif.focalLength ? `焦距 ${exif.focalLength}mm 反映了拍摄距离和压缩感，` : ''}这些参数直接影响画面呈现效果。`
          : `自然摄影中${exif.shutterSpeed ? `快门 ${exif.shutterSpeed}s` : ''}${exif.focalLength ? `、焦距 ${exif.focalLength}mm` : ''} 对主体捕捉和细节还原至关重要，请在评估时重点参考。`;

      return `\n## 拍摄技术参数（重要参考）
${genreHint}

完整参数：
${lines.map((l) => `- ${l}`).join('\n')}

${EXIF_DISCLAIMER}`;
    }

    case 'standard': {
      // 标准注入 — 常规参考
      return `\n## 技术参数参考
${lines.map((l) => `- ${l}`).join('\n')}

${EXIF_DISCLAIMER}`;
    }

    case 'light': {
      // 轻量注入 — 仅展示，不强调
      const summary = buildExifSummary(exif);
      return `\n参考技术参数：${summary}${exif.cameraModel ? `（${exif.cameraModel}）` : ''}

${EXIF_DISCLAIMER}`;
    }

    case 'minimal': {
      // 最小注入 — 明确仅供参考
      const summary = buildExifSummary(exif);
      return `\n以下技术参数仅供参考，请以艺术表达效果为最终判断依据。
参数：${summary}

${EXIF_DISCLAIMER}`;
    }
  }
}

// ============================================================
// 用户笔记和自定义元数据格式化
// ============================================================

function formatUserNotes(notes: string): string {
  return `\n## 拍摄者备注
${notes}`;
}

function formatCustomMetadata(custom: Record<string, unknown>): string {
  const entries = Object.entries(custom)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);

  if (entries.length === 0) return '';
  return `\n## 补充信息
${entries.join('\n')}`;
}

// ============================================================
// 共享基础上下文构建
// ============================================================

/** 构建 Exif / userNotes / custom 三段共享上下文（三个 Agent 均使用） */
function buildBaseContext(context: EvaluationContext, genre: Genre): string {
  let block = '';
  if (context.exif) {
    block += formatExifBlock(context.exif, genre);
  }
  if (context.userNotes) {
    block += formatUserNotes(context.userNotes);
  }
  if (context.custom && Object.keys(context.custom).length > 0) {
    block += formatCustomMetadata(context.custom);
  }
  return block;
}

// ============================================================
// 公共 API — 面向各 Agent 的上下文格式化
// ============================================================

/**
 * 为 Proposer 格式化上下文
 * 完整注入 EXIF + 用户笔记 + 自定义元数据 + 门类检测思维链（如启用）
 */
export function formatContextForProposer(context: EvaluationContext, genre: Genre): string {
  let block = '';

  // 门类检测思维链：让 Proposer 了解门类判定依据
  if (context.genreDetectionThinking) {
    block += `\n## 门类检测依据
以下是对本照片门类判定的推理过程，可作为评估参考：
<genre_detection_thinking>
${context.genreDetectionThinking}
</genre_detection_thinking>`;
  }

  block += buildBaseContext(context, genre);
  return block;
}

/**
 * 为 Critic 格式化上下文
 * 重点是一致性校验提示 — 让 Critic 校验提案者的技术评估是否与 EXIF 参数一致
 */
export function formatContextForCritic(context: EvaluationContext, genre: Genre): string {
  let block = '';

  if (context.exif) {
    const summary = buildExifSummary(context.exif);
    if (summary) {
      block += `\n## 补充参考信息
拍摄参数：${summary}。
请注意校验提案者的技术评估是否与这些参数一致。`;
    }
  }

  block += buildBaseContext(context, genre);
  return block;
}

/**
 * 为 Arbiter 格式化上下文
 * 在仲裁提示末尾追加参考上下文，辅助最终裁决
 */
export function formatContextForArbiter(context: EvaluationContext, genre: Genre): string {
  return buildBaseContext(context, genre);
}
