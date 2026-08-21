import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync(
  '.github/workflows/cloudflare-auto-tenant-import-canary.yml',
  'utf8'
);
const script = fs.readFileSync('scripts/cloudflare-auto-tenant-import-canary.mjs', 'utf8');
const cloudflarePlatform = fs.readFileSync('worker/cloudflare-platform.js', 'utf8');

function expectWorkflow(value) {
  expect(workflow.includes(value), `missing automatic canary workflow contract: ${value}`).toBe(true);
}

function expectScript(value) {
  expect(script.includes(value), `missing automatic canary script contract: ${value}`).toBe(true);
}

describe('automatic tenant import production canary', () => {
  it('keeps Cloudflare credentials out of pull-request validation and runs production only after a trusted deploy', () => {
    const validateStart = workflow.indexOf('  validate:');
    const canaryStart = workflow.indexOf('  canary:');
    expect(validateStart).toBeGreaterThan(-1);
    expect(canaryStart).toBeGreaterThan(validateStart);
    const validateBlock = workflow.slice(validateStart, canaryStart);
    expect(validateBlock).toContain("if: github.event_name == 'pull_request'");
    expect(validateBlock).not.toContain('secrets.CLOUDFLARE');
    expectWorkflow('workflow_run:');
    expectWorkflow('workflows: ["Deploy Catalog Engine application"]');
    expectWorkflow("github.event.workflow_run.conclusion == 'success'");
    expectWorkflow("github.event.workflow_run.head_branch == 'main'");
    expectWorkflow('secrets.CLOUDFLARE_API_TOKEN');
    expectWorkflow('secrets.CLOUDFLARE_ACCOUNT_ID');
    expectWorkflow('Checkout trusted main');
    expectWorkflow('ref: main');
    expect(workflow).not.toMatch(/^  push:/m);
  });

  it('stays green when automation is intentionally disabled and only publishes canary status when enabled', () => {
    expectWorkflow('Detect automatic tenant discovery state');
    expectWorkflow("if: steps.automation.outputs.enabled == 'false'");
    expectWorkflow("success() && steps.automation.outputs.enabled == 'true'");
    expectWorkflow("failure() && steps.automation.outputs.enabled == 'true'");
    expectWorkflow('github.event.workflow_run.head_sha');
    expectWorkflow('TENANT_IMPORT_AUTOMATION_ENABLED=0');
  });

  it('uses the canonical tenant Worker identity required by the dispatch hot path', () => {
    expectScript('workerScriptName: `ce-${suffix}`');
    expect(script).not.toContain('workerScriptName: `ce-auto-${suffix}`');
    expect(cloudflarePlatform).toContain('workerScriptName: `ce-${tenantId.slice(2)}`');
  });

  it('proves scheduler ownership by never producing Queue or post-import jobs manually', () => {
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '1'");
    expectScript('INSERT INTO tenant_provisioning_runs');
    expectScript('waitForSchedulerDiscovery');
    expectScript('waitForCompletion');
    expectScript('waitForCeiCompletion');
    expectScript('manualQueueMessagesProduced: false');
    expect(script).not.toContain('INSERT INTO tenant_import_jobs');
    expect(script).not.toContain('INSERT INTO tenant_classification_jobs');
    expect(script).not.toContain('INSERT INTO tenant_verification_jobs');
    expect(script).not.toContain('/messages');
    expect(script).not.toContain('pushMessage(');
    expect(script).not.toContain('buildTenantImportScanMessage');
    expect(script).not.toContain('buildTenantImportFinalizeMessage');
    expect(script).not.toContain('runDueTenantClassifications');
    expect(script).not.toContain('runDueTenantVerifications');
  });

  it('creates the isolated fixture on the current tenant schema and proves CEI persistence', () => {
    expectScript("from '../worker/tenant-data-plane-schema-v4.js'");
    expectScript('TENANT_DATA_PLANE_SCHEMA_VERSION');
    expectScript('CATALOG_CLASSIFIER_VERSION');
    expectScript('CATALOG_CLASSIFIER_KEY');
    expectScript('CEI_INTELLIGENCE_STATE_CONTRACT_VERSION');
    expectScript('catalog_product_intelligence_state');
    expectScript('auto_canary_cei_state_incomplete');
    expectScript('ceiPipelineVerified: true');
    expectWorkflow('src/catalog-intelligence/**');
    expectWorkflow('worker/tenant-data-plane-schema-v4.js');
    expectWorkflow('tenant-classification-runner.js');
    expectWorkflow('tenant-verification-runner.js');
  });

  it('preserves a safe control-plane error code when scheduler-owned work fails', () => {
    expectScript('safeJobErrorCode');
    expectScript('jobErrorCode');
    expectScript('tenant_data_plane');
    expectScript('tenant_classification');
    expectScript('tenant_verification');
    expectScript('cloudflare_platform');
  });

  it('fails closed around isolation, public/private leaks and Queue evidence', () => {
    expectScript('auto_canary_default_catalog_changed');
    expectScript('auto_canary_public_leak_detected');
    expectScript('auto_canary_cei_private_state_leak');
    expectScript('auto_canary_queue_not_empty');
    expectScript('auto_canary_queue_did_not_drain');
    expectScript('autoCanaryFixtureRetained: true');
    expect(script).not.toContain('/purge');
    expectWorkflow('catalog-engine/tenant-import-auto-canary');
  });
});
