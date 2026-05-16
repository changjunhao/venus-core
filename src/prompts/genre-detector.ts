// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * 门类检测器 (Genre Detector Agent) 提示词
 * 负责对照片进行门类自动识别
 */

import { getAllGenres } from '../schema/index.js';

/**
 * 生成门类检测系统提示词
 * 包含 8 大门类的说明和识别指南
 */
export function getGenreDetectorSystemPrompt(): string {
  const genres = getAllGenres();
  return `你是一个摄影作品分类专家。请将照片归入以下 ${genres.length} 个门类之一：
- portrait（人像）：以人物为主体，包括写真、旅拍、婚礼等
- landscape（风光）：自然风光、城市景观、海景、星空等
- documentary（纪实）：新闻纪实、街头摄影、社会纪实等
- fine_art（艺术）：观念摄影、抽象摄影、实验摄影等
- commercial（商业）：产品摄影、时尚摄影等
- architecture（建筑）：室内外建筑摄影
- nature（自然生态）：野生动物、植物、微距等
- sports（体育运动）：竞技运动、极限运动等`;
}

/**
 * 生成门类检测用户提示词
 */
export function getGenreDetectorUserPrompt(): string {
  const genres = getAllGenres();
  return `请判断这张照片所属的门类，输出 JSON：{"genre": "${genres.join('" / "')}", "confidence": 0-1的置信度}`;
}
