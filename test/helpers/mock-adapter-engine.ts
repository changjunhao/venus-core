// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type { VenusEngine } from '../../src/engine.js';
import type {
  GroupCompareEvaluationResult,
  GroupEvaluationStreamEvent,
  GroupJointEvaluationResult,
} from '../../src/types.js';
import { MOCK_EVALUATION_RESULT, MOCK_STREAM_EVENTS } from './mock-data.js';

/** Default group image URLs used by adapter group tests */
export const MOCK_GROUP_IMAGE_URLS = ['https://example.com/photo-1.jpg', 'https://example.com/photo-2.jpg'];

/** Reusable mock joint group evaluation result */
export const MOCK_GROUP_JOINT_RESULT: GroupJointEvaluationResult = {
  imageUrls: MOCK_GROUP_IMAGE_URLS,
  mode: 'joint',
  genre: 'portrait',
  sceneType: 'studio',
  totalScore: 8,
  dimensions: {
    facial_expression: 8,
    pose_body: 8,
    lighting_quality: 8,
    color_mood: 8,
    composition_focus: 8,
  },
  groupAnalysis: 'Consistent series.',
  critique: 'Great group.',
  suggestions: 'Tighten the sequencing.',
  arbitrationNotes: 'Balanced group evaluation.',
  process: {
    proposal: { result: {} as any, reasoning: null },
    critique: { result: {} as any, reasoning: null },
    arbitration: { result: {} as any, reasoning: null },
  },
  metadata: {
    evaluatedAt: new Date().toISOString(),
    durationMs: 2345,
    rounds: 3,
    imageCount: MOCK_GROUP_IMAGE_URLS.length,
    includePerImage: false,
  },
};

/** Reusable mock compare group evaluation result */
export const MOCK_GROUP_COMPARE_RESULT: GroupCompareEvaluationResult = {
  imageUrls: MOCK_GROUP_IMAGE_URLS,
  mode: 'compare',
  genre: 'portrait',
  ranking: [
    { index: 1, rank: 1, score: 8.5, rationale: 'Stronger light.' },
    { index: 0, rank: 2, score: 7.5, rationale: 'Flatter expression.' },
  ],
  comparisonSummary: 'The second frame leads.',
  suggestions: 'Reshoot the first frame.',
  arbitrationNotes: 'Ranking upheld.',
  process: {
    proposal: { result: {} as any, reasoning: null },
    critique: { result: {} as any, reasoning: null },
    arbitration: { result: {} as any, reasoning: null },
  },
  metadata: {
    evaluatedAt: new Date().toISOString(),
    durationMs: 3456,
    rounds: 3,
    imageCount: MOCK_GROUP_IMAGE_URLS.length,
    includePerImage: false,
  },
};

/** Reusable mock group stream events used by adapter group tests */
export const MOCK_GROUP_STREAM_EVENTS: GroupEvaluationStreamEvent[] = [
  {
    type: 'group_evaluation_start',
    data: { imageUrls: MOCK_GROUP_IMAGE_URLS, mode: 'joint', genre: 'portrait' },
    timestamp: Date.now(),
  },
  { type: 'agent_call', round: 1, agent: 'proposer', timestamp: Date.now() },
  { type: 'agent_complete', round: 1, agent: 'proposer', data: { result: {}, reasoning: null }, timestamp: Date.now() },
  { type: 'group_evaluation_complete', data: MOCK_GROUP_JOINT_RESULT, timestamp: Date.now() },
];

/**
 * Overrides for the mock adapter engine factory.
 * Allows tests to substitute the `evaluate` and/or `evaluateStream` methods
 * (and their group counterparts).
 */
export interface MockAdapterEngineOverrides {
  evaluate?: VenusEngine['evaluate'];
  evaluateStream?: VenusEngine['evaluateStream'];
  evaluateGroup?: VenusEngine['evaluateGroup'];
  evaluateGroupStream?: VenusEngine['evaluateGroupStream'];
}

/**
 * Build a minimal VenusEngine stub for adapter integration tests.
 *
 * By default, `evaluate()` resolves with {@link MOCK_EVALUATION_RESULT} and
 * `evaluateStream()` yields {@link MOCK_STREAM_EVENTS} in order; `evaluateGroup()`
 * resolves with the joint/compare mock matching the requested mode and
 * `evaluateGroupStream()` yields {@link MOCK_GROUP_STREAM_EVENTS}. Any method
 * can be overridden to simulate engine errors or custom event sequences.
 */
export function createMockEngine(overrides?: MockAdapterEngineOverrides): VenusEngine {
  return {
    evaluate: overrides?.evaluate ?? (async () => MOCK_EVALUATION_RESULT),
    evaluateStream:
      overrides?.evaluateStream ??
      async function* () {
        for (const event of MOCK_STREAM_EVENTS) {
          yield event;
        }
      },
    evaluateGroup:
      overrides?.evaluateGroup ??
      (async (imageUrls: string[], mode: 'joint' | 'compare') =>
        mode === 'compare'
          ? { ...MOCK_GROUP_COMPARE_RESULT, imageUrls }
          : { ...MOCK_GROUP_JOINT_RESULT, imageUrls }),
    evaluateGroupStream:
      overrides?.evaluateGroupStream ??
      async function* () {
        for (const event of MOCK_GROUP_STREAM_EVENTS) {
          yield event;
        }
      },
  } as unknown as VenusEngine;
}

// Re-export shared mock data so adapter tests only need one import path.
export { MOCK_EVALUATION_RESULT, MOCK_STREAM_EVENTS };
