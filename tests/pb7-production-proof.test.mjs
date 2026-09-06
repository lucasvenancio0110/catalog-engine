import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluatePb7ProductionProof,
  safePb7Evidence
} from '../scripts/cloudflare-pb7-production-proof.mjs';

const runtime = { initialImportEnabled: true, recurringSyncEnabled: false };

function liveState(overrides = {}) {
  return {
    prerequisites: { tenant_count: 1, active_source: 1, merchant_decision: 1 },
    provisioning: { status: 'running', current_step: 'import', updated_at: '2026-09-06T14:20:00Z' },
    importJob: {
      status: 'details',
      phase: 'details',
      discovered_count: 240,
      queued_detail_count: 240,
      completed_detail_count: 88,
      failed_detail_count: 0,
      deferred_detail_count: 0,
      published_product_count: 0,
      updated_at: '2026-09-06T14:21:00Z'
    },
    classificationJob: null,
    verificationJob: null,
    ...overrides
  };
}

describe('PB7 real-merchant production proof', () => {
  it('accepts a truthful durable progress state without fake completion data', () => {
    const evaluation = evaluatePb7ProductionProof(liveState(), runtime);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.progress).toMatchObject({
      stage: 'importing',
      status: 'running',
      counters: { discovered: 240, completed: 88 },
      pollAfterMs: 8000
    });
    expect(evaluation.progress).not.toHaveProperty('percent');
    expect(evaluation.progress).not.toHaveProperty('eta');
  });

  it('fails closed when merchant authority or recurring-sync boundary is not proven', () => {
    expect(
      evaluatePb7ProductionProof(
        liveState({ prerequisites: { tenant_count: 1, active_source: 1, merchant_decision: 0 } }),
        runtime
      ).passed
    ).toBe(false);
    expect(evaluatePb7ProductionProof(liveState(), { ...runtime, recurringSyncEnabled: true }).passed).toBe(false);
  });

  it('keeps private internal retry data out of the merchant-safe projection', () => {
    const evaluation = evaluatePb7ProductionProof(
      liveState({
        importJob: {
          ...liveState().importJob,
          status: 'failed',
          phase: 'details',
          next_attempt_at: 'https://private.example.invalid/retry'
        }
      }),
      runtime
    );
    expect(evaluation.passed).toBe(true);
    expect(evaluation.progress.retry).toEqual({ kind: 'automatic' });
    expect(JSON.stringify(evaluation.progress)).not.toMatch(/private\.example|https?:\/\//i);
  });

  it('publishes only bounded merchant-safe evidence', () => {
    const evaluation = evaluatePb7ProductionProof(liveState(), runtime);
    const evidence = safePb7Evidence('CROCCODILOS', evaluation);
    expect(evidence).toMatchObject({
      pb7ProductionProof: 'passed',
      merchant: 'CROCCODILOS',
      stage: 'importing',
      status: 'running',
      privateIdentifiersExposed: false,
      recurringIntelligentSyncEnabled: false
    });
    expect(JSON.stringify(evidence)).not.toMatch(/tenantId|provisioningId|importId|sourceLocator|yupoo\.com|https?:\/\//i);
  });

  it('keeps the workflow exact-main-SHA, secret-free on PRs and read-only in production', () => {
    const workflow = fs.readFileSync('.github/workflows/cloudflare-pb7-production-proof.yml', 'utf8');
    const script = fs.readFileSync('scripts/cloudflare-pb7-production-proof.mjs', 'utf8');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/pb7-production-proof');
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(script).toContain('queryD1Batch');
    expect(script).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    expect(script).toContain('secondDurableRead');
  });
});
