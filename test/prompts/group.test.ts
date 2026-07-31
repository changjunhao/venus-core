// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import { describe, it, expect } from 'bun:test';
import {
  getGroupProposerSystemPrompt,
  getGroupProposerUserPrompt,
  getGroupCriticSystemPrompt,
  getGroupCriticUserPrompt,
  getGroupRevisionUserPrompt,
  getGroupArbiterSystemPrompt,
  getGroupArbiterUserPrompt,
} from '../../src/prompts/group.js';
import { getGenreConfig } from '../../src/schema/index.js';
import { ALL_GENRES } from '../helpers/mock-data.js';
import type {
  EvaluationContext,
  CritiqueResult,
  GroupJointProposerResult,
  GroupCompareProposerResult,
} from '../../src/types.js';

const SAMPLE_EXIF: EvaluationContext = {
  exif: {
    shutterSpeed: '1/2000',
    iso: 400,
    fNumber: 2.8,
    focalLength: 85,
  },
};

const JOINT_PROPOSAL: GroupJointProposerResult = {
  scene_type: 'studio',
  total_score: 8.0,
  dimensions: {
    facial_expression: 8.0,
    pose_body: 8.0,
    lighting_quality: 8.0,
    color_mood: 8.0,
    composition_focus: 8.0,
  },
  group_analysis: '整体叙事完整。',
  critique: '组照完成度较高。',
  suggestions: '收尾可更有力。',
};

const COMPARE_PROPOSAL: GroupCompareProposerResult = {
  ranking: [
    { index: 0, rank: 1, score: 8.0, rationale: '光影最佳。' },
    { index: 1, rank: 2, score: 7.0, rationale: '构图稍弱。' },
    { index: 2, rank: 3, score: 6.5, rationale: '主体模糊。' },
  ],
  comparison_summary: '第 1 张综合最优。',
  suggestions: '统一后期风格。',
};

const CRITIQUE_LOW: CritiqueResult = {
  scene_type_review: {
    proposer_scene: 'studio',
    is_correct: true,
    correct_scene: null,
    reason: '判断正确。',
  },
  challenges: [],
  severity: 'LOW',
  overall_assessment: '评估整体合理。',
  suggested_total_score: 8.0,
};

const CRITIQUE_HIGH: CritiqueResult = {
  ...CRITIQUE_LOW,
  challenges: [{ dimension: 'lighting_quality', issue: '虚高。', evidence: '光比失衡。', suggested_score: 6.0 }],
  severity: 'HIGH',
  overall_assessment: '评分明显虚高。',
  suggested_total_score: 6.5,
};

describe('Group Prompts', () => {
  // ── Proposer 系统提示词 ──
  describe('getGroupProposerSystemPrompt()', () => {
    it.each(ALL_GENRES)('should generate joint & compare system prompts for "%s"', (genre) => {
      const joint = getGroupProposerSystemPrompt('joint', genre, 3, false);
      const compare = getGroupProposerSystemPrompt('compare', genre, 3, false);
      expect(joint.length).toBeGreaterThan(500);
      expect(compare.length).toBeGreaterThan(500);
      expect(joint).toContain(getGenreConfig(genre).label);
      expect(compare).toContain(getGenreConfig(genre).label);
    });

    it('joint prompt should emphasize group narrative and consistency', () => {
      const prompt = getGroupProposerSystemPrompt('joint', 'portrait', 4, false);
      expect(prompt).toContain('整体叙事');
      expect(prompt).toContain('风格一致性');
      expect(prompt).toContain('组照完成度');
      expect(prompt).toContain('group_analysis');
      expect(prompt).toContain('scene_type');
      expect(prompt).not.toContain('ranking');
    });

    it('compare prompt should emphasize ranking under a unified standard', () => {
      const prompt = getGroupProposerSystemPrompt('compare', 'portrait', 4, false);
      expect(prompt).toContain('同一标准');
      expect(prompt).toContain('排名');
      expect(prompt).toContain('ranking');
      expect(prompt).toContain('comparison_summary');
      expect(prompt).toContain('不得重复');
      expect(prompt).not.toContain('group_analysis');
    });

    it('should include the image reference protocol with imageCount', () => {
      for (const mode of ['joint', 'compare'] as const) {
        const prompt = getGroupProposerSystemPrompt(mode, 'landscape', 5, false);
        expect(prompt).toContain('你将看到 5 张图片');
        expect(prompt).toContain('index 从 0 开始');
        expect(prompt).toContain('第 5 张');
      }
    });

    it('should mention per_image only when includePerImage=true', () => {
      for (const mode of ['joint', 'compare'] as const) {
        const withPerImage = getGroupProposerSystemPrompt(mode, 'portrait', 3, true);
        const withoutPerImage = getGroupProposerSystemPrompt(mode, 'portrait', 3, false);
        expect(withPerImage).toContain('per_image');
        expect(withPerImage).toContain('per_image 数组长度必须为 3');
        expect(withoutPerImage).not.toContain('per_image');
      }
    });

    it('compare prompt should constrain ranking length and index/rank bounds', () => {
      const prompt = getGroupProposerSystemPrompt('compare', 'portrait', 4, false);
      expect(prompt).toContain('ranking 数组长度必须为 4');
      expect(prompt).toContain('0 到 3');
      expect(prompt).toContain('1 到 4');
    });

    it('should include strict JSON output requirement', () => {
      const prompt = getGroupProposerSystemPrompt('joint', 'portrait', 3, false);
      expect(prompt).toContain('必须且只能输出一个严格的 JSON 对象');
    });

    it('should throw for unknown genre', () => {
      // @ts-expect-error testing runtime error for invalid genre
      expect(() => getGroupProposerSystemPrompt('joint', 'unknown_genre', 3, false)).toThrow('Unknown genre');
    });
  });

  // ── Proposer 用户提示词 ──
  describe('getGroupProposerUserPrompt()', () => {
    it('should include image count and genre label', () => {
      const prompt = getGroupProposerUserPrompt('joint', 'landscape', 4);
      expect(prompt).toContain('4 张');
      expect(prompt).toContain('风光');
    });

    it('should differ between joint and compare instructions', () => {
      const joint = getGroupProposerUserPrompt('joint', 'portrait', 3);
      const compare = getGroupProposerUserPrompt('compare', 'portrait', 3);
      expect(joint).toContain('整体评估');
      expect(compare).toContain('对比评估');
      expect(joint).not.toBe(compare);
    });

    it('should include EXIF context when provided', () => {
      const prompt = getGroupProposerUserPrompt('joint', 'portrait', 3, SAMPLE_EXIF);
      expect(prompt).toContain('1/2000');
      expect(prompt).toContain('f/2.8');
    });
  });

  // ── Critic ──
  describe('getGroupCriticSystemPrompt()', () => {
    it('should include CritiqueSchema output structure for both modes', () => {
      for (const mode of ['joint', 'compare'] as const) {
        const prompt = getGroupCriticSystemPrompt(mode, 'portrait');
        expect(prompt).toContain('scene_type_review');
        expect(prompt).toContain('challenges');
        expect(prompt).toContain('severity');
        expect(prompt).toContain('suggested_total_score');
      }
    });

    it('joint version should target group-level review; compare version should target ranking', () => {
      const joint = getGroupCriticSystemPrompt('joint', 'portrait');
      const compare = getGroupCriticSystemPrompt('compare', 'portrait');
      expect(joint).toContain('风格一致性');
      expect(compare).toContain('排名');
      expect(compare).toContain('ranking');
    });
  });

  describe('getGroupCriticUserPrompt()', () => {
    it('should embed the proposal JSON', () => {
      const prompt = getGroupCriticUserPrompt('joint', 'portrait', JOINT_PROPOSAL, null);
      expect(prompt).toContain('"scene_type": "studio"');
      expect(prompt).toContain('"group_analysis"');
    });

    it('should wrap proposer reasoning in <proposer_reasoning> tag when provided', () => {
      const prompt = getGroupCriticUserPrompt('compare', 'portrait', COMPARE_PROPOSAL, '我认为第 1 张更佳……');
      expect(prompt).toContain('<proposer_reasoning>');
      expect(prompt).toContain('我认为第 1 张更佳……');
    });

    it('should omit reasoning block when reasoning is null', () => {
      const prompt = getGroupCriticUserPrompt('joint', 'portrait', JOINT_PROPOSAL, null);
      expect(prompt).not.toContain('<proposer_reasoning>');
    });

    it('should include EXIF context when provided', () => {
      const prompt = getGroupCriticUserPrompt('joint', 'portrait', JOINT_PROPOSAL, null, SAMPLE_EXIF);
      expect(prompt).toContain('1/2000');
    });
  });

  // ── Revision ──
  describe('getGroupRevisionUserPrompt()', () => {
    it('should embed original proposal and critique JSON', () => {
      const prompt = getGroupRevisionUserPrompt('joint', 'portrait', JOINT_PROPOSAL, CRITIQUE_HIGH, null);
      expect(prompt).toContain('"scene_type": "studio"');
      expect(prompt).toContain('"severity": "HIGH"');
    });

    it('should wrap critique reasoning in <critic_reasoning> tag when provided', () => {
      const prompt = getGroupRevisionUserPrompt(
        'compare',
        'portrait',
        COMPARE_PROPOSAL,
        CRITIQUE_HIGH,
        '排名依据不足……',
      );
      expect(prompt).toContain('<critic_reasoning>');
      expect(prompt).toContain('排名依据不足……');
    });

    it('should include EXIF context when provided', () => {
      const prompt = getGroupRevisionUserPrompt('joint', 'portrait', JOINT_PROPOSAL, CRITIQUE_HIGH, null, SAMPLE_EXIF);
      expect(prompt).toContain('1/2000');
    });
  });

  // ── Arbiter ──
  describe('getGroupArbiterSystemPrompt()', () => {
    it('should require arbitration_notes in the output structure for both modes', () => {
      for (const mode of ['joint', 'compare'] as const) {
        const prompt = getGroupArbiterSystemPrompt(mode, 'portrait', 3, false);
        expect(prompt).toContain('arbitration_notes');
        expect(prompt).toContain('必须且只能输出一个严格的 JSON 对象');
      }
    });

    it('should include the image reference protocol', () => {
      const prompt = getGroupArbiterSystemPrompt('joint', 'portrait', 4, false);
      expect(prompt).toContain('你将看到 4 张图片');
    });

    it('should mention per_image only when includePerImage=true', () => {
      for (const mode of ['joint', 'compare'] as const) {
        expect(getGroupArbiterSystemPrompt(mode, 'portrait', 3, true)).toContain('per_image');
        expect(getGroupArbiterSystemPrompt(mode, 'portrait', 3, false)).not.toContain('per_image');
      }
    });

    it('joint version should include scene_type fields; compare version should include ranking', () => {
      const joint = getGroupArbiterSystemPrompt('joint', 'portrait', 3, false);
      const compare = getGroupArbiterSystemPrompt('compare', 'portrait', 3, false);
      expect(joint).toContain('scene_type');
      expect(joint).toContain('group_analysis');
      expect(compare).toContain('ranking');
      expect(compare).toContain('comparison_summary');
    });
  });

  describe('getGroupArbiterUserPrompt()', () => {
    it('should embed proposal and critique JSON', () => {
      const prompt = getGroupArbiterUserPrompt(
        'joint',
        'portrait',
        JOINT_PROPOSAL,
        CRITIQUE_HIGH,
        null,
        null,
        null,
        null,
      );
      expect(prompt).toContain('"scene_type": "studio"');
      expect(prompt).toContain('"severity": "HIGH"');
    });

    it('should include all reasoning blocks when provided', () => {
      const prompt = getGroupArbiterUserPrompt(
        'joint',
        'portrait',
        JOINT_PROPOSAL,
        CRITIQUE_HIGH,
        JOINT_PROPOSAL,
        '提案推理……',
        '批判推理……',
        '修正推理……',
      );
      expect(prompt).toContain('<proposer_reasoning>');
      expect(prompt).toContain('<critic_reasoning>');
      expect(prompt).toContain('<revision_reasoning>');
    });

    it('should omit revision section when revision is null', () => {
      const prompt = getGroupArbiterUserPrompt(
        'joint',
        'portrait',
        JOINT_PROPOSAL,
        CRITIQUE_HIGH,
        null,
        null,
        null,
        null,
      );
      expect(prompt).not.toContain('修正评分');
      expect(prompt).not.toContain('<revision_reasoning>');
    });

    it('should include LOW severity fast-track hint', () => {
      const low = getGroupArbiterUserPrompt('joint', 'portrait', JOINT_PROPOSAL, CRITIQUE_LOW, null, null, null, null);
      const high = getGroupArbiterUserPrompt(
        'joint',
        'portrait',
        JOINT_PROPOSAL,
        CRITIQUE_HIGH,
        null,
        null,
        null,
        null,
      );
      expect(low).toContain('严重程度为 LOW');
      expect(high).not.toContain('严重程度为 LOW');
    });

    it('should include EXIF context when provided', () => {
      const prompt = getGroupArbiterUserPrompt(
        'compare',
        'portrait',
        COMPARE_PROPOSAL,
        CRITIQUE_LOW,
        null,
        null,
        null,
        null,
        SAMPLE_EXIF,
      );
      expect(prompt).toContain('1/2000');
    });
  });
});
