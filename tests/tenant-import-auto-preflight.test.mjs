import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = fs.readFileSync('.github/workflows/tenant-import-auto-preflight.yml', 'utf8');
const script = fs.readFileSync('scripts/tenant-import-auto-preflight.mjs', 'utf8');

function expectWorkflow(value) {
  expect(workflow.includes(value), `missing workflow contract: ${value}`).toBe(true);
}

function expectScript(value) {
  expect(script.includes(value), `missing preflight contract: ${value}`).toBe(true);
}

describe('tenant import automation production preflight', () => {
  it('keeps PR validation secret-free and runs production reads only on trusted events', () => {
    expectWorkflow("if: github.event_name == 'pull_request'");
    expectWorkflow("if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    const validateStart = workflow.indexOf('  validate:');
    const preflightStart = workflow.indexOf('  preflight:');
    expect(workflow.slice(validateStart, preflightStart)).not.toContain('secrets.CLOUDFLARE');
    expect(workflow.slice(preflightStart)).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow.slice(preflightStart)).toContain('secrets.CLOUDFLARE_API_TOKEN');
  });

  it('refuses to run after automation is already enabled', () => {
    expectScript("TENANT_IMPORT_AUTOMATION_ENABLED || '') !== '0'");
    expectScript('tenant_import_preflight_requires_automation_off');
  });

  it('mirrors the dispatcher eligibility, import-decision and due-job predicates read-only', () => {
    expectScript("r.current_step='import'");
    expectScript("r.status IN ('running','failed','blocked')");
    expectScript("i.status='provisioning'");
    expectScript('i.schema_version >= 3');
    expectScript('JOIN tenant_import_decisions d');
    expectScript('d.source_locator_ref=c.source_locator_ref');
    expectScript("d.status='confirmed'");
    expectScript("d.decision_kind='full_connected_source'");
    expectScript("p.database_status='active'");
    expectScript("p.worker_status='active'");
    expectScript("j.status IN ('pending','queued','scanning','details','finalizing')");
    expectScript("phase='scan' AND status IN ('pending','failed')");
    expectScript("status IN ('details','finalizing')");
  });

  it('requires no active import work, no leftover smoke tenants and zero Queue/DLQ backlog', () => {
    expectScript('undispatchedCandidates');
    expectScript('dueScanOrRetryJobs');
    expectScript('dueFinalizeJobs');
    expectScript('activeImportJobs');
    expectScript('leftoverDisposableTenants');
    expectScript('catalog-engine-import-scan-dlq');
    expectScript('catalog-engine-import-detail-dlq');
    expectScript('Object.values(summary.queueBacklogs).some');
    expectScript('tenant_import_preflight_not_clean');
  });

  it('publishes only aggregate operational counts, not tenant or supplier identifiers', () => {
    const output = script.slice(script.indexOf('const summary ='));
    expect(output).not.toContain('source_url');
    expect(output).not.toContain('tenant_id');
    expect(output).not.toContain('worker_script_name');
    expect(output).not.toContain('d1_database_id');
  });
});
