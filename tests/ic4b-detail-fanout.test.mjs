import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildIc4bDetailConfig,
  detailConsumerShape,
  safeIc4bConfigSummary
} from '../scripts/build-ic4b-detail-config.mjs';
import {
  IC4B_DETAIL_FANOUT_CONTRACT_VERSION,
  IC4B_DETAIL_QUEUE_ROLLBACK,
  IC4B_DETAIL_QUEUE_TARGET,
  IC4B_MIN_OBSERVED_WORKER_CONCURRENCY,
  IC4B_PROBE_MESSAGE_COUNT,
  assertIc4bDetailQueueTarget,
  evaluateIc4bFanoutProbe
} from '../worker/ingestion/ic4b-detail-fanout-contract.js';

const rollbackConfig = JSON.parse(fs.readFileSync('wrangler.import-detail.jsonc', 'utf8'));
const activationWorkflow = fs.readFileSync('.github/workflows/activate-tenant-import-queues.yml', 'utf8');
const proofWorkflow = fs.readFileSync('.github/workflows/cloudflare-ic4b-detail-fanout.yml', 'utf8');
const ic4aWorkflow = fs.readFileSync('.github/workflows/cloudflare-ic4a-detail-baseline.yml', 'utf8');
const probeHarness = fs.readFileSync('scripts/cloudflare-ic4b-detail-fanout.mjs', 'utf8');
const probeWorker = fs.readFileSync('worker/ic4b-fanout-probe.js', 'utf8');

function withoutTopology(config) {
  const clone = structuredClone(config);
  const consumer = clone.queues.consumers.find((entry) => entry.queue === 'catalog-engine-import-detail');
  for (const key of [
    'max_batch_size',
    'max_batch_timeout',
    'max_retries',
    'max_concurrency',
    'retry_delay'
  ]) {
    delete consumer[key];
  }
  return clone;
}

describe('IC4B Queue micro-delivery and bounded horizontal fan-out', () => {
  it('persists an explicit 1/4 target and exact 4/2 rollback authority', () => {
    expect(IC4B_DETAIL_FANOUT_CONTRACT_VERSION).toBe(1);
    expect(IC4B_DETAIL_QUEUE_TARGET).toEqual({
      maxBatchSize: 1,
      maxBatchTimeoutSeconds: 5,
      maxConcurrency: 4,
      maxRetries: 5,
      retryDelaySeconds: 120
    });
    expect(IC4B_DETAIL_QUEUE_ROLLBACK).toEqual({
      maxBatchSize: 4,
      maxBatchTimeoutSeconds: 5,
      maxConcurrency: 2,
      maxRetries: 5,
      retryDelaySeconds: 120
    });
    expect(IC4B_MIN_OBSERVED_WORKER_CONCURRENCY).toBe(3);
    expect(IC4B_PROBE_MESSAGE_COUNT).toBe(24);
  });

  it('builds the promoted config from the rollback template without changing bindings or infrastructure', () => {
    const baseline = detailConsumerShape(rollbackConfig);
    expect(baseline).toMatchObject({
      maxBatchSize: 4,
      maxBatchTimeoutSeconds: 5,
      maxConcurrency: 2,
      maxRetries: 5,
      retryDelaySeconds: 120,
      deadLetterQueue: 'catalog-engine-import-detail-dlq'
    });

    const promoted = buildIc4bDetailConfig(rollbackConfig);
    expect(assertIc4bDetailQueueTarget(detailConsumerShape(promoted))).toBe(true);
    expect(safeIc4bConfigSummary(promoted)).toEqual({
      batchSize: 1,
      batchTimeoutSeconds: 5,
      maxConcurrency: 4,
      maxRetries: 5,
      retryDelaySeconds: 120,
      dlqConfigured: true
    });
    expect(withoutTopology(promoted)).toEqual(withoutTopology(rollbackConfig));
  });

  it('fails closed if the rollback template drifts before promotion', () => {
    const drifted = structuredClone(rollbackConfig);
    drifted.queues.consumers[0].max_concurrency = 3;
    expect(() => buildIc4bDetailConfig(drifted)).toThrow(
      'ic4b_rollback_template_mismatch_maxConcurrency'
    );
  });

  it('requires measured worker-level concurrency above the former two-consumer ceiling and full cleanup', () => {
    expect(
      evaluateIc4bFanoutProbe({
        completed: 24,
        maxObservedActive: 3,
        configuredMaxConcurrency: 4,
        workerCleaned: true,
        queueCleaned: true,
        dlqCleaned: true,
        databaseCleaned: true
      }).passed
    ).toBe(true);
    expect(
      evaluateIc4bFanoutProbe({
        completed: 24,
        maxObservedActive: 2,
        configuredMaxConcurrency: 4,
        workerCleaned: true,
        queueCleaned: true,
        dlqCleaned: true,
        databaseCleaned: true
      }).passed
    ).toBe(false);
    expect(
      evaluateIc4bFanoutProbe({
        completed: 24,
        maxObservedActive: 5,
        configuredMaxConcurrency: 4,
        workerCleaned: true,
        queueCleaned: true,
        dlqCleaned: true,
        databaseCleaned: true
      }).passed
    ).toBe(false);
    expect(
      evaluateIc4bFanoutProbe({
        completed: 24,
        maxObservedActive: 4,
        configuredMaxConcurrency: 4,
        workerCleaned: true,
        queueCleaned: true,
        dlqCleaned: false,
        databaseCleaned: true
      }).passed
    ).toBe(false);
  });

  it('promotes only through trusted exact-SHA Queue activation and verifies the live 1/4 settings', () => {
    expect(activationWorkflow).toContain('Build bounded IC4B detail consumer config');
    expect(activationWorkflow).toContain('scripts/build-ic4b-detail-config.mjs');
    expect(activationWorkflow).toContain('/tmp/wrangler.import-detail.ic4b.json');
    expect(activationWorkflow).toContain('batch_size) !== 1');
    expect(activationWorkflow).toContain('max_concurrency) !== 4');
    expect(activationWorkflow).toContain('max_retries) !== 5');
    expect(activationWorkflow).toContain('group: catalog-engine-production-d1');
    expect(activationWorkflow).toContain('ref: ${{ steps.target.outputs.sha }}');
  });

  it('uses an isolated D1-backed concurrency probe with no supplier/provider fetch path', () => {
    expect(probeWorker).toContain('env.PROBE_DB');
    expect(probeWorker).toContain('max_active');
    expect(probeWorker).toContain('HOLD_MS = 1500');
    expect(probeWorker).not.toContain('fetch(');
    expect(probeHarness).toContain('/messages/batch');
    expect(probeHarness).toContain('/consumers');
    expect(probeHarness).toContain('IC4B_MIN_OBSERVED_WORKER_CONCURRENCY');
    expect(probeHarness).toContain('providerRegressionGate');
    expect(probeHarness).toContain('crossTenantRegressionGate');
    expect(probeHarness).toContain('privateIdentifiersExposed: false');
  });

  it('gates production proof on exact deploy, Queue, real provider, LKG and isolation evidence', () => {
    expect(proofWorkflow).toContain("workflows: ['Deploy Catalog Engine application']");
    expect(proofWorkflow).toContain('catalog-engine/application-deploy');
    expect(proofWorkflow).toContain('catalog-engine/queue-consumer-activation');
    expect(proofWorkflow).toContain('catalog-engine/tenant-import-auto-canary');
    expect(proofWorkflow).toContain('catalog-engine/pb9-production-proof');
    expect(proofWorkflow).toContain('catalog-engine/ic2-production-proof');
    expect(proofWorkflow).toContain('catalog-engine/ic3-production-proof');
    expect(proofWorkflow).toContain('group: catalog-engine-production-d1');
    expect(proofWorkflow).toContain('ref: ${{ env.TARGET_SHA }}');
    expect(proofWorkflow).toContain('Delete all isolated IC4B proof resources');
    expect(proofWorkflow).toContain('if: always()');
    expect(proofWorkflow).toContain('catalog-engine/ic4b-detail-fanout');
    const validateBlock = proofWorkflow.split('\n  prerequisites:')[0];
    expect(validateBlock).not.toContain('secrets.CLOUDFLARE');
  });

  it('retires IC4A only as a live topology gate while preserving its closed historical proof contract', () => {
    expect(ic4aWorkflow).toContain('docs/IC4A-CLOSURE-2026-09-07.md');
    expect(ic4aWorkflow).not.toContain('workflow_run:');
    expect(ic4aWorkflow).not.toContain('secrets.CLOUDFLARE');
    expect(ic4aWorkflow).toContain('tests/ic4a-detail-baseline.test.mjs');
  });
});
