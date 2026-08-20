import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/cloudflare-real-queue-resilience-smoke.yml', 'utf8');
const script = fs.readFileSync('scripts/cloudflare-real-queue-resilience-smoke.mjs', 'utf8');

function expectWorkflow(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

function expectScript(value) {
  expect(script.includes(value), `missing resilience contract: ${value}`).toBe(true);
}

describe('real Queue retry/DLQ/recovery smoke', () => {
  it('keeps production credentials out of pull-request validation', () => {
    expectWorkflow("if: github.event_name == 'pull_request'");
    expectWorkflow("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    const validateStart = workflow.indexOf('  validate:');
    const smokeStart = workflow.indexOf('  smoke:');
    expect(workflow.slice(validateStart, smokeStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow.slice(smokeStart)).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow.slice(smokeStart)).toContain('secrets.CLOUDFLARE_API_TOKEN');
  });

  it('requires automation OFF throughout the real resilience proof', () => {
    expectWorkflow('Assert automatic tenant discovery remains OFF');
    expectWorkflow('"TENANT_IMPORT_AUTOMATION_ENABLED": "0"');
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0'");
    expectWorkflow('Queue resilience smoke failed; automatic tenant discovery remains OFF');
  });

  it('deliberately drives a real detail delivery from retry into the production DLQ', () => {
    expectScript("const DETAIL_QUEUE = 'catalog-engine-import-detail'");
    expectScript("const DETAIL_DLQ = 'catalog-engine-import-detail-dlq'");
    expectScript("VALUES (?1, ?2, ?3, 'initial', 'queued', 'scan', 0");
    expectScript('await push(queues.get(DETAIL_QUEUE), detailMessage);');
    expectScript('await waitForBacklog(queues.get(DETAIL_DLQ), 1, DLQ_TIMEOUT_MS)');
    expectScript('queue_resilience_dlq_timeout');
  });

  it('proves the poison delivery cannot mutate tenant catalog data before repair', () => {
    expectScript("SELECT COUNT(*) AS total FROM catalog_products");
    expectScript("SELECT COUNT(*) AS total FROM supplier_album_detail_state");
    expectScript('queue_resilience_mutated_before_recovery');
    expectScript('noMutationBeforeRecovery: true');
  });

  it('repairs durable state, replays the same opaque message, finalizes, then purges historical DLQ evidence', () => {
    expectScript("await updateImportPhase(fixture, 'details', 'details');");
    expectScript('await push(queues.get(DETAIL_QUEUE), detailMessage);');
    expectScript('const recovered = await waitForDetailSuccess(fixture);');
    expectScript('buildTenantImportFinalizeMessage');
    expectScript('const finalized = await waitFinalize(fixture);');
    expectScript('await purge(queues.get(DETAIL_DLQ));');
    expectScript('const finalQueues = await waitAllQueuesClean(queues);');
  });

  it('uses disposable isolated resources and never prints private supplier URLs in success output', () => {
    expectScript('uploadTenantCatalogWorker');
    expectScript('tenantDataPlaneCurrentBatch');
    expectScript('cleanupFixture');
    expectScript('DELETE FROM catalog_tenants WHERE tenant_id=?1');
    const summaryStart = script.indexOf('queueResilienceSmokePassed: true');
    expect(summaryStart).toBeGreaterThan(-1);
    const summary = script.slice(summaryStart, summaryStart + 1200);
    expect(summary).not.toContain('sourceUrl');
    expect(summary).not.toContain('x.yupoo.com');
    expect(summary).toContain('realRetryToDlq: true');
    expect(summary).toContain('replayRecovered: true');
  });
});
