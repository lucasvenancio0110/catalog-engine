import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_GOVERNOR_CONTRACT,
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
