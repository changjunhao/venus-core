import { describe, it, expect } from 'bun:test';
import { createMockEngine } from './helpers/mock-engine.js';
import { evaluateRequestSchema } from '../src/adapters/common.js';
import {
  formatContextForProposer,
  formatContextForCritic,
  formatContextForArbiter,
} from '../src/prompts/context-formatter.js';
import { getProposerUserPrompt } from '../src/prompts/proposer.js';
import { getCriticUserPrompt } from '../src/prompts/critic.js';
import { getArbiterUserPrompt } from '../src/prompts/arbiter.js';
import type { EvaluationContext, ExifData } from '../src/types.js';
import { PORTRAIT_DIMS, makeDimensions } from './helpers/mock-data.js';

// ── Shared Constants ─────────────────────────────────────

function makeProposalJSON(score = 7.5) {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: score,
    dimensions: makeDimensions(PORTRAIT_DIMS, score),
    critique: 'Good portrait.',
    suggestions: 'Try different lighting.',
  });
}

function makeCritiqueJSON(severity = 'MEDIUM') {
  return JSON.stringify({
    scene_type_review: {
      proposer_scene: 'studio',
      is_correct: true,
      correct_scene: null,
      reason: 'Correct classification.',
    },
    challenges: [
      {
        dimension: 'facial_expression',
        issue: 'Expression could be more natural.',
        evidence: 'Slight tension visible.',
        suggested_score: 6.5,
      },
    ],
    severity,
    overall_assessment: 'Generally solid.',
    suggested_total_score: 7.0,
  });
}

function makeArbiterJSON() {
  return JSON.stringify({
    scene_type: 'studio',
    total_score: 7.2,
    dimensions: makeDimensions(PORTRAIT_DIMS, 7.2),
    critique: 'Well-executed studio portrait.',
    suggestions: 'Work on natural expressions.',
    arbitration_notes: 'Balanced evaluation after review.',
  });
}

const TEST_IMAGE = 'https://example.com/test-portrait.jpg';

const SAMPLE_EXIF: ExifData = {
  shutterSpeed: '1/2000',
  iso: 400,
  fNumber: 2.8,
  focalLength: 85,
  cameraModel: 'SONY ILCE-7M4',
  lensModel: 'FE 85mm F1.4 GM',
  dateTimeOriginal: '2026:03:15 14:30:00',
  flash: 'fired',
};

const SAMPLE_CONTEXT: EvaluationContext = {
  exif: SAMPLE_EXIF,
  userNotes: '这张照片是在自然光下拍摄的户外人像',
};

// ═══════════════════════════════════════════════════════════
// 1. 向后兼容测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — Backward Compatibility', () => {
  it('evaluate() without context should behave identically to before', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const result = await engine.evaluate(TEST_IMAGE, 'portrait');

    expect(result.genre).toBe('portrait');
    expect(result.totalScore).toBe(7.2);
    expect(result.metadata.rounds).toBe(3);
    expect(result.process.proposal).toBeDefined();
    expect(result.process.critique).toBeDefined();
    expect(result.process.arbitration).toBeDefined();
  });

  it('evaluate() without context should have no context in metadata', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('LOW') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const result = await engine.evaluate(TEST_IMAGE, 'portrait');

    expect(result.metadata.context).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// 2. EXIF 上下文注入测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — EXIF Injection', () => {
  it('Proposer userPrompt should contain EXIF technical parameters when exif is provided', () => {
    const prompt = getProposerUserPrompt('portrait', { exif: SAMPLE_EXIF });

    expect(prompt).toContain('1/2000');
    expect(prompt).toContain('2.8');
    expect(prompt).toContain('85');
    expect(prompt).toContain('400');
  });

  it('Prompt should include disclaimer about EXIF data', () => {
    const prompt = getProposerUserPrompt('portrait', { exif: SAMPLE_EXIF });

    expect(prompt).toContain('以照片实际视觉效果为最终评判依据');
  });

  it('Critic prompt should contain EXIF data when context is provided', () => {
    const proposalResult = {
      scene_type: 'studio',
      total_score: 7.5,
      dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
      critique: 'Good.',
      suggestions: 'Improve.',
    };
    const prompt = getCriticUserPrompt('portrait', proposalResult, null, { exif: SAMPLE_EXIF });

    expect(prompt).toContain('1/2000');
    expect(prompt).toContain('以照片实际视觉效果为最终评判依据');
  });

  it('Arbiter prompt should contain EXIF data when context is provided', () => {
    const prompt = getArbiterUserPrompt(
      'portrait',
      {
        scene_type: 'studio',
        total_score: 7.5,
        dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
        critique: 'Good.',
        suggestions: 'Improve.',
      },
      {
        scene_type_review: { proposer_scene: 'studio', is_correct: true, correct_scene: null, reason: 'OK.' },
        challenges: [],
        severity: 'LOW' as const,
        overall_assessment: 'Solid.',
        suggested_total_score: 7.5,
      },
      null,
      null,
      null,
      { exif: SAMPLE_EXIF },
    );

    expect(prompt).toContain('1/2000');
    expect(prompt).toContain('以照片实际视觉效果为最终评判依据');
  });
});

// ═══════════════════════════════════════════════════════════
// 3. 用户笔记注入测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — User Notes Injection', () => {
  it('Proposer prompt should contain userNotes text', () => {
    const notes = '这是一张黄昏时分拍摄的逆光人像';
    const prompt = getProposerUserPrompt('portrait', { userNotes: notes });

    expect(prompt).toContain(notes);
    expect(prompt).toContain('拍摄者备注');
  });

  it('Critic prompt should contain userNotes text', () => {
    const notes = '使用了反光板补光';
    const prompt = getCriticUserPrompt(
      'portrait',
      {
        scene_type: 'studio',
        total_score: 7.5,
        dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
        critique: 'Good.',
        suggestions: 'Improve.',
      },
      null,
      { userNotes: notes },
    );

    expect(prompt).toContain(notes);
  });

  it('Arbiter prompt should contain userNotes text', () => {
    const notes = '参赛作品，请严格评分';
    const prompt = getArbiterUserPrompt(
      'portrait',
      {
        scene_type: 'studio',
        total_score: 7.5,
        dimensions: makeDimensions(PORTRAIT_DIMS, 7.5),
        critique: 'Good.',
        suggestions: 'Improve.',
      },
      {
        scene_type_review: { proposer_scene: 'studio', is_correct: true, correct_scene: null, reason: 'OK.' },
        challenges: [],
        severity: 'LOW' as const,
        overall_assessment: 'Solid.',
        suggested_total_score: 7.5,
      },
      null,
      null,
      null,
      { userNotes: notes },
    );

    expect(prompt).toContain(notes);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. metadata 回传测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — Metadata Pass-through', () => {
  it('evaluate() with context should return context in metadata', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('LOW') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const result = await engine.evaluate(TEST_IMAGE, 'portrait', SAMPLE_CONTEXT);

    expect(result.metadata.context).toBeDefined();
    expect(result.metadata.context!.exif).toEqual(SAMPLE_EXIF);
    expect(result.metadata.context!.userNotes).toBe(SAMPLE_CONTEXT.userNotes);
  });

  it('evaluateStream() with context should return context in final result metadata', async () => {
    const engine = createMockEngine({
      proposerResponses: [{ content: makeProposalJSON() }],
      criticResponses: [{ content: makeCritiqueJSON('MEDIUM') }],
      arbiterResponses: [{ content: makeArbiterJSON() }],
    });

    const events = [];
    for await (const event of engine.evaluateStream(TEST_IMAGE, { genre: 'portrait', context: SAMPLE_CONTEXT })) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1]!;
    expect(lastEvent.type).toBe('evaluation_complete');
    if (lastEvent.type === 'evaluation_complete') {
      expect((lastEvent as any).data.metadata.context).toBeDefined();
      expect((lastEvent as any).data.metadata.context!.exif).toEqual(SAMPLE_EXIF);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 5. context-formatter 单元测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — context-formatter', () => {
  describe('formatContextForProposer', () => {
    it('should return formatted EXIF block for portrait genre', () => {
      const result = formatContextForProposer({ exif: SAMPLE_EXIF }, 'portrait');

      expect(result).toContain('1/2000');
      expect(result).toContain('f/2.8');
      expect(result).toContain('ISO');
      expect(result).toContain('85mm');
      expect(result).toContain('SONY ILCE-7M4');
      expect(result).toContain('闪光灯');
      expect(result).toContain('fired');
    });

    it('should include user notes when provided', () => {
      const result = formatContextForProposer({ userNotes: '测试笔记' }, 'portrait');

      expect(result).toContain('测试笔记');
      expect(result).toContain('拍摄者备注');
    });

    it('should return empty string for empty context', () => {
      const result = formatContextForProposer({}, 'portrait');
      expect(result).toBe('');
    });

    it('should return empty string when exif has no valid fields', () => {
      const result = formatContextForProposer({ exif: {} }, 'portrait');
      expect(result).toBe('');
    });
  });

  describe('formatContextForCritic', () => {
    it('should include consistency check hint', () => {
      const result = formatContextForCritic({ exif: SAMPLE_EXIF }, 'portrait');

      expect(result).toContain('校验提案者的技术评估是否与这些参数一致');
    });

    it('should return empty string for empty context', () => {
      const result = formatContextForCritic({}, 'landscape');
      expect(result).toBe('');
    });
  });

  describe('formatContextForArbiter', () => {
    it('should include EXIF block', () => {
      const result = formatContextForArbiter({ exif: SAMPLE_EXIF }, 'portrait');

      expect(result).toContain('1/2000');
      expect(result).toContain('f/2.8');
    });

    it('should return empty string for empty context', () => {
      const result = formatContextForArbiter({}, 'documentary');
      expect(result).toBe('');
    });
  });

  describe('Genre-differentiated injection levels', () => {
    const exif: ExifData = { shutterSpeed: '1/4000', fNumber: 2.8, focalLength: 400, iso: 1600 };

    it('sports genre should use high injection level (重要参考)', () => {
      const result = formatContextForProposer({ exif }, 'sports');

      expect(result).toContain('重要参考');
      expect(result).toContain('体育摄影');
    });

    it('nature genre should use high injection level', () => {
      const result = formatContextForProposer({ exif }, 'nature');

      expect(result).toContain('重要参考');
      expect(result).toContain('自然摄影');
    });

    it('portrait genre should use standard injection level (技术参数参考)', () => {
      const result = formatContextForProposer({ exif }, 'portrait');

      expect(result).toContain('技术参数参考');
      // Should NOT have the "重要参考" header
      expect(result).not.toContain('重要参考');
    });

    it('fine_art genre should use minimal injection level (仅供参考)', () => {
      const result = formatContextForProposer({ exif }, 'fine_art');

      expect(result).toContain('仅供参考');
      expect(result).toContain('艺术表达效果为最终判断依据');
    });

    it('architecture genre should use light injection level', () => {
      const result = formatContextForProposer({ exif }, 'architecture');

      expect(result).toContain('参考技术参数');
      // Light level uses summary format, not full list
      expect(result).not.toContain('重要参考');
    });

    it('commercial genre should use light injection level', () => {
      const result = formatContextForProposer({ exif }, 'commercial');

      expect(result).toContain('参考技术参数');
      expect(result).not.toContain('重要参考');
      expect(result).not.toContain('技术参数参考');
    });

    it('documentary genre should use light injection level', () => {
      const result = formatContextForProposer({ exif }, 'documentary');

      expect(result).toContain('参考技术参数');
      expect(result).not.toContain('重要参考');
    });

    it('landscape genre should use standard injection level', () => {
      const result = formatContextForProposer({ exif }, 'landscape');

      expect(result).toContain('技术参数参考');
      expect(result).not.toContain('重要参考');
      expect(result).not.toContain('仅供参考');
    });

    it('unknown genre should fall back to standard injection level (default branch)', () => {
      // Cast to any to exercise the default branch in getExifInjectionLevel
      const result = formatContextForProposer({ exif }, 'unknown_genre' as any);

      expect(result).toContain('技术参数参考');
      expect(result).not.toContain('重要参考');
    });

    it('fine_art minimal mode should produce the full expected output format', () => {
      const minimalExif: ExifData = {
        shutterSpeed: '1/125',
        fNumber: 5.6,
        iso: 200,
        focalLength: 50,
      };
      const result = formatContextForProposer({ exif: minimalExif }, 'fine_art');

      // Minimal block structure: disclaimer line + 参数 summary line + EXIF disclaimer
      expect(result).toContain('以下技术参数仅供参考，请以艺术表达效果为最终判断依据。');
      expect(result).toContain('参数：快门 1/125s、光圈 f/5.6、ISO 200、焦距 50mm');
      expect(result).toContain('注意：EXIF 数据可能经后期修改，请以照片实际视觉效果为最终评判依据。');
      // Minimal mode should NOT include the bullet list or "完整参数" header used by other modes
      expect(result).not.toContain('完整参数');
      expect(result).not.toContain('- 快门速度');
    });
  });

  // ─────────────────────────────────────────────────────────
  // formatCustomMetadata 边界条件（通过公共 API 间接测试）
  // ─────────────────────────────────────────────────────────
  describe('Custom Metadata Formatting', () => {
    it('should return empty string when all custom values are null/undefined', () => {
      const result = formatContextForProposer({ custom: { a: null, b: undefined, c: null } }, 'portrait');
      expect(result).toBe('');
    });

    it('should return empty string for empty custom object', () => {
      const result = formatContextForProposer({ custom: {} }, 'portrait');
      expect(result).toBe('');
    });

    it('should JSON.stringify nested object values', () => {
      const result = formatContextForProposer({ custom: { meta: { tripName: '北疆', day: 3 } } }, 'portrait');

      expect(result).toContain('## 补充信息');
      expect(result).toContain('- meta：');
      expect(result).toContain('"tripName":"北疆"');
      expect(result).toContain('"day":3');
    });

    it('should JSON.stringify array values (typeof object)', () => {
      const result = formatContextForProposer({ custom: { tags: ['portrait', 'studio'] } }, 'portrait');

      expect(result).toContain('- tags：["portrait","studio"]');
    });

    it('should filter out null/undefined entries while keeping valid ones', () => {
      const result = formatContextForProposer(
        {
          custom: {
            location: 'Tokyo',
            event: null,
            note: undefined,
            count: 0,
            isPublic: false,
          },
        },
        'portrait',
      );

      expect(result).toContain('## 补充信息');
      expect(result).toContain('- location：Tokyo');
      // 0 and false should be preserved (only null/undefined are filtered)
      expect(result).toContain('- count：0');
      expect(result).toContain('- isPublic：false');
      expect(result).not.toContain('- event');
      expect(result).not.toContain('- note');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 6. 适配器 schema 校验测试
// ═══════════════════════════════════════════════════════════

describe('Context Extension — Adapter Schema Validation', () => {
  it('should pass with valid EXIF context', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      genre: 'portrait',
      context: {
        exif: {
          shutterSpeed: '1/2000',
          iso: 400,
          fNumber: 2.8,
          focalLength: 85,
          cameraModel: 'SONY ILCE-7M4',
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('should pass with flash field in EXIF context', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      genre: 'portrait',
      context: {
        exif: {
          shutterSpeed: '1/200',
          flash: 'auto, fired',
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context?.exif?.flash).toBe('auto, fired');
    }
  });

  it('should fail when userNotes exceeds 2000 characters', () => {
    const longNotes = 'A'.repeat(2001);
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      context: {
        userNotes: longNotes,
      },
    });

    expect(result.success).toBe(false);
  });

  it('should pass when userNotes is exactly 2000 characters', () => {
    const maxNotes = 'A'.repeat(2000);
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      context: {
        userNotes: maxNotes,
      },
    });

    expect(result.success).toBe(true);
  });

  it('should pass with empty context object', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      context: {},
    });

    expect(result.success).toBe(true);
  });

  it('should pass without context field at all', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
    });

    expect(result.success).toBe(true);
  });

  it('should pass with context containing custom metadata', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      context: {
        custom: { location: 'Tokyo', event: 'Wedding' },
      },
    });

    expect(result.success).toBe(true);
  });

  it('should pass with full context (exif + userNotes + custom)', () => {
    const result = evaluateRequestSchema.safeParse({
      imageUrl: 'https://example.com/photo.jpg',
      genre: 'landscape',
      context: {
        exif: { shutterSpeed: '1/500', iso: 100, fNumber: 11 },
        userNotes: '日出时分拍摄',
        custom: { tripName: '北疆之行' },
      },
    });

    expect(result.success).toBe(true);
  });
});
