import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateIc1ProductionProof,
  safeIc1Evidence
} from '../scripts/cloudflare-ic1-production-proof.mjs';

const runtime = { initialImportEnabled: true, recurringSyncEnabled: false };

function liveState(overrides = {}) {
  return {
    prerequisites: {
      tenant_count: 1,
      active_source: 1,
      confirmed_decision: 1,
      decision_confirmed_at: '2026-09-06T14:00:00Z'
    },
    decision: { confirmed_at: '2026-09-06T14:00:00Z' },
    importJob: {
      status: 'success',
      phase: 'finalize',
      discovered_count: 6097,
      queued_detail_count: 6097,
      completed_detail_count: 6097,
      failed_detail_count: 0,
      deferred_detail_count: 0,
      published_product_count: 6097,
      started_at: '2026-09-06T14:00:02Z',
      scan_completed_at: '2026-09-06T14:00:20Z',
      finished_at: '2026-09-06T14:01:40Z',
      updated_at: '2026-09-06T14:01:40Z'
    },
    classificationJob: {
      status: 'success',
      product_count: 6097,
      automatic_count: 6097,
      review_count: 0,
      unknown_count: 0,
      started_at: '2026-09-06T14:01:41Z',
      finished_at: '2026-09-06T14:01:55Z',
      updated_at: '2026-09-06T14:01:55Z'
    },
    verificationJob: {
      status: 'success',
      product_count: 6097,
      finding_count: 0,
      started_at: '2026-09-06T14:01:56Z',
      finished_at: '2026-09-06T14:02:05Z',
      updated_at: '2026-09-06T14:02:05Z'
    },
    ...overrides
  };
}

describe('IC1 production latency proof', () => {
  it('proves the complete safe timing contract from the durable decision boundary', () => {
    const evaluation = evaluateIc1ProductionProof(liveState(), runtime);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.timing).toEqual({
      contract: 'instant-catalog-baseline-v1',
      elapsedMs: 125000,
      milestones: {
        importStartedMs: 2000,
        listingScannedMs: 20000,
        importCompletedMs: 100000,
        classificationCompletedMs: 115000,
        verificationCompletedMs: 125000
      }
    });
    expect(evaluation.productCount).toBe(6097);
  });

  it('fails closed if a real timing boundary is absent or recurring sync is enabled', () => {
    expect(
      evaluateIc1ProductionProof(
        liveState({ importJob: { ...liveState().importJob, scan_completed_at: null } }),
        runtime
      ).passed
    ).toBe(false);
    expect(
      evaluateIc1ProductionProof(liveState(), { ...runtime, recurringSyncEnabled: true }).passed
    ).toBe(false);
  });

  it('emits bounded evidence with no tenant/source/runtime locator', () => {
    const evaluation = evaluateIc1ProductionProof(liveState(), runtime);
    const evidence = safeIc1Evidence('CROCCODILOS', evaluation);
    expect(evidence).toMatchObject({
      ic1ProductionProof: 'passed',
      merchant: 'CROCCODILOS',
      productCount: 6097,
      findings: 0,
      recurringIntelligentSyncEnabled: false,
      privateIdentifiersExposed: false
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /tenantId|provisioningId|sourceLocator|database|dispatch|worker|yupoo\.com|https?:\/\//i
    );
  });

  it('keeps the proof read-only and exact-main-SHA governed', () => {
    const workflow = fs.readFileSync('.github/workflows/cloudflare-ic1-production-proof.yml', 'utf8');
    const script = fs.readFileSync('scripts/cloudflare-ic1-production-proof.mjs', 'utf8');
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('github.event.workflow_run.head_sha');
    expect(workflow).toContain('catalog-engine/ic1-production-proof');
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(script).toContain('queryD1Batch');
    expect(script).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  });
});
