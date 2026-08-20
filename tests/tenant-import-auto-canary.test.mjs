import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-auto-tenant-import-canary.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-auto-tenant-import-canary.mjs', 'utf8');

function expectWorkflow(value) {
  expect(workflow.includes(value), `missing automatic canary workflow contract: ${value}`).toBe(true);
}

function expectScript(value) {
  expect(script.includes(value), `missing automatic canary script contract: ${value}`).toBe(true);
}

describe('automatic tenant import production canary', () => {
  it('keeps Cloudflare credentials out of pull-request validation', () => {
    const validateStart = workflow.indexOf('  validate:');
    const canaryStart = workflow.indexOf('  canary:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(canaryStart).toBeGreaterThan(validateStart);
    const validateBlock = workflow.slice(validateStart, canaryStart);
    expect(validateBlock).toContain("if: github.event_name == 'pull_request'");
    expect(validateBlock).not.toContain('secrets.CLOUDFLARE');
    expectWorkflow("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    expectWorkflow('secrets.CLOUDFLARE_API_TOKEN');
    expectWorkflow('secrets.CLOUDFLARE_ACCOUNT_ID');
    expectWorkflow('Checkout trusted main');
    expectWorkflow('ref: main');
  });

  it('proves scheduler ownership by never producing Queue messages manually', () => {
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1'");
    expectScript('INSERT INTO tenant_provisioning_runs');
    expectScript('waitForSchedulerDiscovery');
    expectScript('waitForCompletion');
    expectScript('manualQueueMessagesProduced: false');
    expect(script).not.toContain('INSERT INTO tenant_import_jobs');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('pushMessage(');
    expect(script).not.toContain('buildTenantImportScanMessage');
    expect(script).not.toContain('buildTenantImportFinalizeMessage');
  });

  it('fails closed around isolation, public leaks and Queue evidence', () => {
    expectScript('auto_canary_default_catalog_changed');
    expectScript('auto_canary_public_leak_detected');
    expectScript('auto_canary_queue_not_empty');
    expectScript('auto_canary_queue_did_not_drain');
    expectScript('autoCanaryFixtureRetained: true');
    expect(script).not.toContain('/purge');
    expectWorkflow('catalog-engine/tenant-import-auto-canary');
  });
});
