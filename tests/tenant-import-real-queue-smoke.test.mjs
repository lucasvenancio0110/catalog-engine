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

  it('requires automatic discovery OFF and mirrors the real queued import state', () => {
    expectWorkflow('Assert automatic tenant discovery is still OFF');
    expectWorkflow('"TENANT_IMPORT_AUTOMATION_ENABLED": "0"');
    expectWorkflow('Prove one tenant then simultaneous two-tenant Queue ingestion');
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0'");
    expectScript("VALUES (?1, ?2, ?3, 'initial', 'queued', 'scan', 0");
    expectScript("const one = await setupFixture('one', scopes[0]);");
    expectScript("const twoA = await setupFixture('two-a', scopes[0]);");
    expectScript("const twoB = await setupFixture('two-b', scopes[1]);");
    expectScript('await Promise.all([');
    expectScript('await proveCrossTenantIsolation');
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

  it('starts only with clean Queues and purges owned smoke messages before fixture cleanup on failure', () => {
    expectScript('assertQueuesClean');
    expectScript('waitQueuesClean');
    expectScript('purgeQueues');
    expectScript('delete_messages_permanently: true');
    expectScript('queue_smoke_queue_not_empty');
    expectScript('if (failed) await purgeQueues(queues);');
    expectScript('await cleanupAllFixtures();');
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
