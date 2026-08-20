import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/cloudflare-real-queue-import-smoke.yml', 'utf8');
const script = fs.readFileSync('scripts/cloudflare-real-queue-import-smoke.mjs', 'utf8');

function expectWorkflow(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

function expectScript(value) {
  expect(script.includes(value), `missing smoke contract: ${value}`).toBe(true);
}

describe('real Cloudflare Queue tenant import smoke', () => {
  it('keeps PR validation secret-free and production smoke restricted to trusted events', () => {
    expectWorkflow("if: github.event_name == 'pull_request'");
    expectWorkflow("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    const validateStart = workflow.indexOf('  validate:');
    const smokeStart = workflow.indexOf('  smoke:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(smokeStart).toBeGreaterThan(validateStart);
    expect(workflow.slice(validateStart, smokeStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow.slice(smokeStart)).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow.slice(smokeStart)).toContain('secrets.CLOUDFLARE_API_TOKEN');
  });

  it('requires automatic discovery OFF and proves one tenant before two simultaneous tenants', () => {
    expectWorkflow('Assert automatic tenant discovery is still OFF');
    expectWorkflow('"TENANT_IMPORT_AUTOMATION_ENABLED": "0"');
    expectWorkflow('Prove one tenant then simultaneous two-tenant Queue ingestion');
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0'");
    expectScript('const single = await runSingle(scopes[0], queues);');
    expectScript('const pair = await runPair(scopes[0], scopes[1], queues);');
    expectScript('await crossTenantIsolation');
  });

  it('uses only opaque Queue messages and disposable isolated tenant resources', () => {
    expectScript('assertPublicSafeImportMessage');
    expectScript('buildTenantImportScanMessage');
    expectScript('buildTenantImportFinalizeMessage');
    expectScript('uploadTenantCatalogWorker');
    expectScript('tenantDataPlaneCurrentBatch');
    expectScript('cleanupFixture');
    expectScript('DELETE FROM catalog_tenants WHERE tenant_id=?1');
    expectScript("method: 'DELETE', allowNotFound: true");
  });

  it('starts only with clean Queues and contains failure containment', () => {
    expectScript('assertQueuesInitiallyClean');
    expectScript('waitQueuesClean');
    expectScript('purgeSmokeQueues');
    expectScript('delete_messages_permanently: true');
    expectScript('queue_smoke_queue_not_empty');
  });

  it('never reports private supplier URLs in the sanitized success summary', () => {
    const summaryStart = script.indexOf('queueImportSmokePassed: true');
    expect(summaryStart).toBeGreaterThan(-1);
    const summary = script.slice(summaryStart, summaryStart + 1200);
    expect(summary).not.toContain('sourceUrl');
    expect(summary).not.toContain('x.yupoo.com');
    expect(summary).toContain('expectedItems');
  });
});
