// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Endpoint host table generator (dev-time only — never runs at library runtime).
 *
 * Fetches https://models.dev/api.json and regenerates `src/providers/endpoint-hosts.ts`,
 * the hostname → EndpointBehavior lookup table consumed by `detectEndpointBehavior`.
 *
 * IMPORTANT: models.dev only provides model/provider METADATA (hosts, capabilities,
 * pricing). It does NOT describe request-body parameter shapes (`enable_thinking`,
 * `thinking: { type }`, effort value mappings, ...). Those live in hand-written
 * `adaptReasoningParams` in `src/providers/reasoning.ts` — this script only
 * cross-references hostnames and must never be extended to drive protocol mapping.
 *
 * Usage: bun run generate:endpoints   (network access required; the generated
 * file is committed, so build/test/publish never depend on this script)
 */

import { z } from 'zod';
import type { EndpointBehavior } from '../src/providers/reasoning.js';

const API_URL = 'https://models.dev/api.json';
const OUTPUT_PATH = new URL('../src/providers/endpoint-hosts.ts', import.meta.url).pathname;

/**
 * Curated mapping: models.dev provider ID prefix → Venus EndpointBehavior.
 * Only providers listed here contribute hosts; everything else is ignored.
 * (OpenAI / Google / xAI use native SDKs on models.dev and expose no `api` field.)
 */
const CURATED_PROVIDER_PREFIXES: ReadonlyArray<readonly [string, EndpointBehavior]> = [
  ['alibaba', 'dashscope'],
  ['moonshotai', 'kimi'],
  ['kimi', 'kimi'],
  ['zhipuai', 'zhipu'],
  ['stepfun', 'stepfun'],
  ['xiaomi', 'mimo'],
  ['deepseek', 'deepseek'],
  ['minimax', 'minimax'],
  ['openrouter', 'openrouter'],
];

/**
 * Manual entries for endpoints missing from models.dev (qianfan, volcanoark) or
 * whose providers use native SDKs there and have no `api` field (gemini, grok).
 * These are matched BEFORE generated hosts.
 */
const MANUAL_HOSTS: ReadonlyArray<readonly [string, EndpointBehavior]> = [
  ['qianfan.baidubce.com', 'qianfan'],
  ['ark.cn-beijing.volces.com', 'volcanoark'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['api.x.ai', 'grok'],
];

/**
 * Broad domain fallbacks preserving the pre-generation matching semantics of
 * `detectEndpointBehavior` (e.g. `deepseek.com` matches any subdomain/path).
 * These are matched AFTER generated hosts.
 */
const GENERIC_FALLBACK_HOSTS: ReadonlyArray<readonly [string, EndpointBehavior]> = [
  ['dashscope.aliyuncs.com', 'dashscope'],
  ['deepseek.com', 'deepseek'],
  ['moonshot.cn', 'kimi'],
  ['moonshot.ai', 'kimi'],
  ['xiaomimimo.com', 'mimo'],
  ['bigmodel.cn', 'zhipu'],
  ['minimaxi.com', 'minimax'],
  ['minimax.io', 'minimax'],
  ['stepfun.com', 'stepfun'],
  ['stepfun.ai', 'stepfun'],
  ['openrouter.ai', 'openrouter'],
];

/** Minimal shape validation — only the fields this script consumes. */
const ApiJsonSchema = z.record(z.string(), z.object({ api: z.string().optional() }).loose());

function resolveBehavior(providerId: string): EndpointBehavior | undefined {
  for (const [prefix, behavior] of CURATED_PROVIDER_PREFIXES) {
    if (providerId === prefix || providerId.startsWith(`${prefix}-`)) return behavior;
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log(`Fetching ${API_URL} ...`);
  let raw: unknown;
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    console.error(`Failed to fetch ${API_URL}: ${(e as Error).message}`);
    console.error('The committed src/providers/endpoint-hosts.ts stays valid — builds are unaffected.');
    process.exit(1);
  }

  const parsed = ApiJsonSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('models.dev api.json no longer matches the expected shape; aborting without writing:');
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }

  // Collect hostnames per behavior from curated providers
  const generated = new Map<string, EndpointBehavior>();
  const matchedPrefixes = new Set<string>();
  for (const [providerId, provider] of Object.entries(parsed.data)) {
    const behavior = resolveBehavior(providerId);
    if (!behavior || !provider.api) continue;
    for (const [prefix] of CURATED_PROVIDER_PREFIXES) {
      if (providerId === prefix || providerId.startsWith(`${prefix}-`)) matchedPrefixes.add(prefix);
    }
    let hostname: string;
    try {
      hostname = new URL(provider.api).hostname;
    } catch {
      console.warn(`WARN: provider '${providerId}' has unparsable api URL: ${provider.api}`);
      continue;
    }
    const existing = generated.get(hostname);
    if (existing && existing !== behavior) {
      console.warn(`WARN: host '${hostname}' maps to both '${existing}' and '${behavior}'; keeping '${existing}'`);
      continue;
    }
    generated.set(hostname, behavior);
  }

  for (const [prefix] of CURATED_PROVIDER_PREFIXES) {
    if (!matchedPrefixes.has(prefix)) {
      console.warn(`WARN: curated prefix '${prefix}' matched no provider with an api field in api.json`);
    }
  }

  // Deterministic order: manual specifics → generated (host length desc, then alpha) → generic fallbacks
  const seen = new Set<string>(MANUAL_HOSTS.map(([host]) => host));
  const generatedEntries = [...generated.entries()]
    .filter(([host]) => !seen.has(host))
    .sort(([a], [b]) => b.length - a.length || a.localeCompare(b));
  for (const [host] of generatedEntries) seen.add(host);
  const fallbackEntries = GENERIC_FALLBACK_HOSTS.filter(([host]) => !seen.has(host));

  const renderEntries = (entries: ReadonlyArray<readonly [string, EndpointBehavior]>): string =>
    entries.map(([host, behavior]) => `  ['${host}', '${behavior}'],`).join('\n');

  const content = `// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

// AUTO-GENERATED by scripts/generate-endpoint-hosts.ts — DO NOT EDIT.
// Source: https://models.dev/api.json (hostnames only; request-body parameter
// shapes remain hand-written in reasoning.ts). Regenerate with:
//   bun run generate:endpoints

import type { EndpointBehavior } from './reasoning.js';

/**
 * Host substring → endpoint behavior lookup table used by \`detectEndpointBehavior\`.
 * Order matters — first match wins: manual entries, then models.dev-derived
 * hostnames (longest first), then broad domain fallbacks.
 */
export const ENDPOINT_HOSTS: ReadonlyArray<readonly [string, EndpointBehavior]> = [
  // Manual entries (missing from models.dev or served via native SDKs there)
${renderEntries(MANUAL_HOSTS)}
  // Derived from models.dev api.json
${renderEntries(generatedEntries)}
  // Broad domain fallbacks
${renderEntries(fallbackEntries)}
];
`;

  await Bun.write(OUTPUT_PATH, content);
  console.log(
    `Wrote ${generatedEntries.length} generated + ${MANUAL_HOSTS.length} manual + ${fallbackEntries.length} fallback hosts to src/providers/endpoint-hosts.ts`,
  );
}

await main();
