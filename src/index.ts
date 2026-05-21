// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Venus Core - Public API
 *
 * Venus AI Photography Evaluation Engine
 * Framework-agnostic, runtime-agnostic TypeScript SDK
 */

// ─── Core Engine ──────────────────────────────────────────
export { VenusEngine, createVenusEngine } from './engine.js';

// ─── Types ────────────────────────────────────────────────
export type * from './types.js';

// ─── Providers ────────────────────────────────────────────
export { createOpenAICompatProvider, defineProvider } from './providers/index.js';
export type { OpenAICompatOptions, DefineProviderOptions, ProviderStyle } from './providers/index.js';

// ─── Schema ───────────────────────────────────────────────
export {
  GenreEnum,
  ExifDataSchema,
  EvaluationContextSchema,
  getSchemas,
  getGenreConfig,
  getMetadata,
  getAllGenres,
} from './schema/index.js';
export type { SubtypeForGenre, DimensionForGenre } from './schema/index.js';

// ─── Errors ───────────────────────────────────────────────
export { VenusError, ValidationError, ProviderError, SchemaError, TimeoutError } from './utils/errors.js';
export type { ProviderErrorCode } from './utils/errors.js';
