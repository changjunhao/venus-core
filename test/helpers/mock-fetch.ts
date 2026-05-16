// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Venus Contributors

/**
 * Shared fetch-mocking utilities for provider/error-handling tests.
 */

const originalFetch = globalThis.fetch;

/** Replace global fetch with a mock implementation */
export function mockFetch(impl: (...args: any[]) => any) {
  globalThis.fetch = impl as typeof globalThis.fetch;
}

/** Restore global fetch to its original value */
export function restoreFetch() {
  globalThis.fetch = originalFetch;
}

/** Build a mock Response mimicking the OpenAI chat completions API */
export function makeOpenAIResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
