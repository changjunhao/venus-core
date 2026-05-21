// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

import type { Genre, EvaluationResult, EvaluationStreamEvent } from '../../src/types.js';

/** All 8 valid photography genres */
export const ALL_GENRES: Genre[] = [
  'portrait',
  'landscape',
  'documentary',
  'fine_art',
  'commercial',
  'architecture',
  'nature',
  'sports',
];

/** Portrait genre evaluation dimensions */
export const PORTRAIT_DIMS = [
  'facial_expression',
  'pose_body',
  'lighting_quality',
  'color_mood',
  'composition_focus',
] as const;

/**
 * Build a dimensions score map where every dimension gets the same score.
 */
export function makeDimensions(dims: readonly string[], score: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const d of dims) result[d] = score;
  return result;
}

/** Default test image URL */
export const IMAGE_URL = 'https://example.com/portrait.jpg';

/** Reusable mock evaluation result used by adapter integration tests */
export const MOCK_EVALUATION_RESULT: EvaluationResult = {
  imageUrl: 'https://example.com/photo.jpg',
  genre: 'portrait',
  sceneType: 'studio',
  totalScore: 7.5,
  dimensions: {
    facial_expression: 7.5,
    pose_body: 7.5,
    lighting_quality: 7.5,
    color_mood: 7.5,
    composition_focus: 7.5,
  },
  critique: 'Great portrait.',
  suggestions: 'Try different lighting.',
  arbitrationNotes: 'Balanced evaluation.',
  process: {
    proposal: { result: {} as any, reasoning: null },
    critique: { result: {} as any, reasoning: null },
    arbitration: { result: {} as any, reasoning: null },
  },
  metadata: {
    evaluatedAt: new Date().toISOString(),
    durationMs: 1234,
    rounds: 3,
  },
};

/** Reusable mock stream events used by adapter integration tests */
export const MOCK_STREAM_EVENTS: EvaluationStreamEvent[] = [
  {
    type: 'evaluation_start',
    data: { imageUrl: 'https://example.com/photo.jpg', genre: 'portrait' },
    timestamp: Date.now(),
  },
  { type: 'agent_call', round: 1, agent: 'proposer', timestamp: Date.now() },
  { type: 'agent_complete', round: 1, agent: 'proposer', data: { result: {}, reasoning: null }, timestamp: Date.now() },
  { type: 'evaluation_complete', data: MOCK_EVALUATION_RESULT, timestamp: Date.now() },
];
