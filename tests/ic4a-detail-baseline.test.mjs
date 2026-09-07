import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  durationSummary,
  evaluateIc4aBaseline,
  historicalDetailBaseline,
  safeIc4aEvidence
} from '../scripts/cloudflare-ic4a-detail-baseline.mjs';
import {
  IC4A_DETAIL_BASELINE_CONTRACT_VERSION,
  IC4A_DETAIL_QUEUE_BASELINE,
  IC4A_MAX_REAL_SAMPLE_SIZE,
  assertIc4aConservativeDetailBaseline
} from '../worker/ingestion/ic4a-detail-baseline-contract.js';

const script = fs.readFileSync('scripts/cloudflare-ic4a-detail-baseline.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/cloudflare-ic4a-detail-baseline.yml', 'utf8');
const detailConfig = JSON.parse(fs.readFileSync('wrangler.import-detail.jsonc', 'utf8'));
const detailConsumer = detailConfig.queues?.consumers?.find(
  (entry) => entry.queue === 'catalog-engine-import-detail'
);

function passingFixture() {
  return {
    runtime: {
      initialImportEnabled: true,
      recurringSyncEnabled: false,
      recurringSyncCohort: '',
      recurringSyncMaxJobs: '1',
      detailQueue: {
        batchSize: 4,
        batchTimeoutSeconds: 5,
        maxConcurrency: 2,
        maxRetries: 5
      }
    },
    queue: {
      detail: { backlogCount: 0, backlogBytes: 0, oldestMessageAgeMs: 0 },
      dlq: { backlogCount: 0, backlogBytes: 0, oldestMessageAgeMs: 0 }
    },
    historical: {
      discovered: 6111,
      terminal: 6111,
      success: 6100,
      skipped: 10,
      deferred: 1,
      failed: 0,
      detailTerminalWindowMs: 3600000,
      terminalProductsPerSecond: 1.697
    },
    sample: {
      requested: 6,
      attempted: 6,
      successful: 6,
      failed: 0,
      providerFetchMs: { count: 6, minMs: 100, meanMs: 150, p50Ms: 140, p95Ms: 220, maxMs: 220 },
      normalizationMs: { count: 6, minMs: 1, meanMs: 2, p50Ms: 2, p95Ms: 4, maxMs: 4 },
      d1WriteMs: { count: 6, minMs: 10, meanMs: 20, p50Ms: 18, p95Ms: 30, maxMs: 30 },
      totalMeasuredMs: { count: 6, minMs: 120, meanMs: 175, p50Ms: 165, p95Ms: 250, maxMs: 250 },
      writeStatements: { count: 6, minMs: 12, meanMs: 14, p50Ms: 14, p95Ms: 16, maxMs: 16 },
      safeErrorCounts: []
    },
    cleanup: true
  };
}

describe('IC4A safe detail throughput baseline', () => {
  it('computes bounded latency summaries deterministically', () => {
    expect(durationSummary([40, 10, 20, 30])).toEqual({
      count: 4,
      minMs: 10,
      meanMs: 25,
      p50Ms: 20,
      p95Ms: 40,
      maxMs: 40
    });
  });

  it('derives historical terminal throughput from detail-state timestamps', () => {
    const baseline = historicalDetailBaseline(
      [
        {
          state: 'success',
          total: 5998,
          first_terminal_at: '2026-09-01 10:00:00',
          last_terminal_at: '2026-09-01 10:59:59'
        },
        {
          state: 'skipped',
          total: 2,
          first_terminal_at: '2026-09-01 10:10:00',
          last_terminal_at: '2026-09-01 11:00:00'
        }
      ],
      6000
    );
    expect(baseline.discovered).toBe(6000);
    expect(baseline.terminal).toBe(6000);
    expect(baseline.detailTerminalWindowMs).toBe(3600000);
    expect(baseline.terminalProductsPerSecond).toBeCloseTo(1.667, 3);
  });

  it('requires measurement while the conservative 4/5/2 Queue boundary is unchanged', () => {
    const fixture = passingFixture();
    expect(evaluateIc4aBaseline(fixture).passed).toBe(true);

    fixture.runtime.detailQueue.maxConcurrency = 3;
    expect(evaluateIc4aBaseline(fixture).passed).toBe(false);
  });

  it('persists the IC4A measurement-only queue boundary under worker code', () => {
    expect(IC4A_DETAIL_BASELINE_CONTRACT_VERSION).toBe(1);
    expect(IC4A_MAX_REAL_SAMPLE_SIZE).toBe(8);
    expect(IC4A_DETAIL_QUEUE_BASELINE).toEqual({
      maxBatchSize: 4,
      maxBatchTimeoutSeconds: 5,
      maxConcurrency: 2,
      maxRetries: 5
    });
    expect(assertIc4aConservativeDetailBaseline(IC4A_DETAIL_QUEUE_BASELINE)).toBe(true);
    expect(() =>
      assertIc4aConservativeDetailBaseline({ ...IC4A_DETAIL_QUEUE_BASELINE, maxConcurrency: 3 })
    ).toThrow('ic4a_detail_baseline_boundary_changed');
  });

  it('rejects safe evidence containing a private provider locator', () => {
    const fixture = passingFixture();
    const evaluation = evaluateIc4aBaseline(fixture);
    fixture.sample.safeErrorCounts = [{ code: 'https://private.x.yupoo.com/albums/1', count: 1 }];
    expect(() => safeIc4aEvidence({ ...fixture, evaluation })).toThrow(
      'ic4a_safe_evidence_private_leak'
    );
  });

  it('uses the Provider Engine, a bounded real sample and an ephemeral current-schema D1', () => {
    expect(script).toContain('resolveCatalogIngestionProvider');
    expect(script).toContain('provider.fetchDetail');
    expect(script).toContain('buildTenantProductWriteBatch');
    expect(script).toContain('tenantDataPlaneCurrentBatch');
    expect(script).toContain('splitD1Batch(schema)');
    expect(script).toContain('createD1Database');
    expect(script).toContain('deleteDatabase');
    expect(script).toContain('MAX_SAMPLE_SIZE = 8');
    expect(script).toContain('oldest_message_timestamp_ms');
  });

  it('keeps the production detail Queue at the IC4A conservative baseline', () => {
    expect(detailConsumer).toMatchObject({
      queue: 'catalog-engine-import-detail',
      max_batch_size: 4,
      max_batch_timeout: 5,
      max_concurrency: 2,
      max_retries: 5
    });
  });

  it('keeps PR validation secret-free and production proof gated by an exact deploy', () => {
    expect(workflow).toContain("if: github.event_name == 'pull_request'");
    expect(workflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(workflow).toContain('catalog-engine/application-deploy');
    expect(workflow).toContain('catalog-engine/queue-consumer-activation');
    expect(workflow).toContain('catalog-engine/ic3-production-proof');
    expect(workflow).toContain('catalog-engine/pb9-production-proof');
    expect(workflow).toContain("consumer?.max_concurrency) !== 2");
    const validateBlock = workflow.split('\n  prove:')[0];
    expect(validateBlock).not.toContain('secrets.CLOUDFLARE');
  });
});
