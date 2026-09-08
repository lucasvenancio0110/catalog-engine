import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_GOVERNOR_CONTRACT,
  ProviderDetailGovernor,
  evolveProviderGovernorState,
  initialProviderGovernorState
} from '../worker/ingestion/provider-detail-governor.js';

function healthy(state, count, startedAt = 1_000) {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = evolveProviderGovernorState(next, { status: 200, latencyMs: 500 }, startedAt + index);
  }
  return next;
}

function fakeDurableState(initialState) {
  const values = new Map([['state', initialState]]);
  return {
    storage: {
      async get(key) {
        return values.get(key);
      },
      async put(key, value) {
        values.set(key, value);
      }
    }
  };
}

describe('IC4C provider detail governor', () => {
  it('starts conservatively and scales additively only after healthy windows', () => {
    const initial = initialProviderGovernorState();
    expect(initial.limit).toBe(2);
    expect(healthy(initial, 7).limit).toBe(2);
    const raised = healthy(initial, 8);
    expect(raised.limit).toBe(3);
    expect(healthy(raised, 8).limit).toBe(4);
    expect(healthy(healthy(raised, 8), 32).limit).toBe(PROVIDER_GOVERNOR_CONTRACT.ceiling);
  });

  it.each([
    [{ status: 429, latencyMs: 600 }, '429'],
    [{ status: 503, latencyMs: 600 }, '5xx'],
    [{ status: 0, latencyMs: 600, timeout: true }, 'timeout'],
    [{ status: 200, latencyMs: 2_500 }, 'latency']
  ])('multiplicatively slows down on %s-class pressure', (signal) => {
    const raised = { ...initialProviderGovernorState(), limit: 4, healthyStreak: 5 };
    const reduced = evolveProviderGovernorState(raised, signal, 10_000);
    expect(reduced.limit).toBe(2);
    expect(reduced.healthyStreak).toBe(0);
    expect(reduced.cooldownUntil).toBeGreaterThan(10_000);
  });

  it('never drops below the hard floor', () => {
    const state = { ...initialProviderGovernorState(), limit: 1 };
    const reduced = evolveProviderGovernorState(state, { status: 429, latencyMs: 100 }, 20_000);
    expect(reduced.limit).toBe(PROVIDER_GOVERNOR_CONTRACT.floor);
  });

  it('enforces the hard ceiling inside the shared Durable Object admission point', async () => {
    const durableState = fakeDurableState({
      ...initialProviderGovernorState(),
      limit: PROVIDER_GOVERNOR_CONTRACT.ceiling
    });
    const governor = new ProviderDetailGovernor(durableState);
    const outcomes = [];
    for (let index = 0; index < PROVIDER_GOVERNOR_CONTRACT.ceiling + 1; index += 1) {
      const response = await governor.fetch(new Request('https://governor.internal/acquire', { method: 'POST' }));
      outcomes.push({ status: response.status, body: await response.json() });
    }
    expect(outcomes.slice(0, PROVIDER_GOVERNOR_CONTRACT.ceiling).every((entry) => entry.body.admitted)).toBe(true);
    expect(outcomes.at(-1).status).toBe(429);
    expect(outcomes.at(-1).body.admitted).toBe(false);
  });

  it('binds a server-side Durable Object and routes both initial and incremental detail handlers through it', () => {
    const config = JSON.parse(fs.readFileSync('wrangler.import-detail.jsonc', 'utf8'));
    expect(config.durable_objects?.bindings).toEqual([
      { name: 'PROVIDER_DETAIL_GOVERNOR', class_name: 'ProviderDetailGovernor' }
    ]);
    expect(config.migrations).toContainEqual({
      tag: 'ic4c-provider-detail-governor-v1',
      new_sqlite_classes: ['ProviderDetailGovernor']
    });

    const entry = fs.readFileSync('worker/import-detail-entry.js', 'utf8');
    expect(entry).toContain('createAdaptiveProviderFetch(env, fetch)');
    expect(entry).toContain('handleTenantImportDetailMessage(parsed, env, { fetchImpl })');
    expect(entry).toContain('handleTenantIncrementalDetailMessage(parsed, env, { fetchImpl })');
    expect(entry).toContain('export { ProviderDetailGovernor }');
  });

  it('keeps provider identity private and preserves the recurring-sync boundary', () => {
    const source = fs.readFileSync('worker/ingestion/provider-detail-governor.js', 'utf8');
    expect(source).toContain("crypto.subtle.digest('SHA-256'");
    expect(source).not.toContain('console.log');
    expect(source).not.toContain('console.error');
    expect(PROVIDER_GOVERNOR_CONTRACT.recurringSyncChanged).toBe(false);
    expect(PROVIDER_GOVERNOR_CONTRACT.ceiling).toBe(4);
  });
});
