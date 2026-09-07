import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateIc3ProductionProof,
  safeIc3Evidence
} from '../scripts/cloudflare-ic3-listing-proof.mjs';
import {
  IC3_LISTING_PROOF_BASELINE_SHA,
  IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT,
  IC3_LISTING_PROOF_REQUEST_CONCURRENCY
} from '../worker/ingestion/ic3-listing-proof-contract.js';

function scan(ids, { concurrency = IC3_LISTING_PROOF_REQUEST_CONCURRENCY, categories = 3 } = {}) {
  return {
    complete: true,
    items: ids.map((id) => ({ publicProductId: `p_${String(id).padStart(20, '0')}` })),
    taxonomy: Array.from({ length: categories }, (_unused, index) => ({ id: String(index + 1) })),
    stats: {
      rootPages: 4,
      categoryPages: 12,
      requestConcurrency: concurrency
    }
  };
}

const healthyRuntime = Object.freeze({
  initialImportEnabled: true,
  recurringSyncEnabled: false,
  activeSyncCohort: '',
  maxSyncJobsPerTick: '1'
});

describe('IC3 real listing production proof', () => {
  it('passes only when the bounded fan-out is measurably faster with identical catalog identity', () => {
    const ids = [1, 2, 3, 4, 5];
    const evaluation = evaluateIc3ProductionProof({
      current: scan(ids),
      baseline: scan(ids, { concurrency: 0 }),
      currentMs: 40_000,
      baselineMs: 80_000,
      runtime: healthyRuntime
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.identityMatch).toBe(true);
    expect(evaluation.taxonomyMatch).toBe(true);
    expect(evaluation.improvementPct).toBe(50);
    expect(evaluation.speedupRatio).toBe(2);
    expect(evaluation.checks.boundedConcurrency).toBe(true);
  });

  it('fails closed when the new scan changes product identity or count', () => {
    const evaluation = evaluateIc3ProductionProof({
      current: scan([1, 2, 3, 9]),
      baseline: scan([1, 2, 3, 4, 5], { concurrency: 0 }),
      currentMs: 30_000,
      baselineMs: 90_000,
      runtime: healthyRuntime
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.identityMatch).toBe(false);
  });

  it('does not call request jitter a production improvement', () => {
    const ids = [1, 2, 3];
    const baselineMs = 100_000;
    const currentMs = Math.round(
      baselineMs * (1 - (IC3_LISTING_PROOF_MIN_IMPROVEMENT_PCT - 0.5) / 100)
    );
    const evaluation = evaluateIc3ProductionProof({
      current: scan(ids),
      baseline: scan(ids, { concurrency: 0 }),
      currentMs,
      baselineMs,
      runtime: healthyRuntime
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.measuredImprovement).toBe(false);
  });

  it('keeps activation safety boundaries in the production gate', () => {
    const ids = [1, 2, 3];
    const evaluation = evaluateIc3ProductionProof({
      current: scan(ids),
      baseline: scan(ids, { concurrency: 0 }),
      currentMs: 20_000,
      baselineMs: 80_000,
      runtime: {
        ...healthyRuntime,
        recurringSyncEnabled: true,
        activeSyncCohort: 'unexpected'
      }
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.recurringSyncDisabled).toBe(false);
    expect(evaluation.checks.syncCohortEmpty).toBe(false);
  });

  it('emits only bounded safe production and network-utilization evidence', () => {
    const ids = [1, 2, 3];
    const evaluation = evaluateIc3ProductionProof({
      current: scan(ids),
      baseline: scan(ids, { concurrency: 0 }),
      currentMs: 25_000,
      baselineMs: 75_000,
      runtime: healthyRuntime
    });
    const evidence = safeIc3Evidence('CROCCODILOS', evaluation, {
      current: { requests: 21, maxActive: 4 },
      baseline: { requests: 39, maxActive: 4 }
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.privateIdentifiersExposed).toBe(false);
    expect(evidence).toMatchObject({
      fanoutRequests: 21,
      baselineRequests: 39,
      fanoutMaxActive: 4,
      baselineMaxActive: 4
    });
    expect(serialized).not.toMatch(/https?:\/\/|yupoo\.com|source_url|album_source_id|database_id/i);
    expect(evidence).not.toHaveProperty('sourceUrl');
    expect(evidence).not.toHaveProperty('provider');
  });

  it('pins the comparison to the exact pre-IC3 scanner and keeps trusted proof post-deploy', () => {
    const workflow = fs.readFileSync(
      '.github/workflows/cloudflare-ic3-listing-production-proof.yml',
      'utf8'
    );

    expect(IC3_LISTING_PROOF_BASELINE_SHA).toBe(
      'c8450ac306af455977f899047e6fafec9600eebf'
    );
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('catalog-engine/ic3-production-proof');
    expect(workflow).toContain('catalog-engine/queue-consumer-activation');
    expect(workflow).toContain('catalog-engine/pb9-production-proof');
    expect(workflow).toContain('catalog-engine/ic2-production-proof');
    expect(workflow).not.toMatch(/^\s*push:\s*$/m);
  });
});
