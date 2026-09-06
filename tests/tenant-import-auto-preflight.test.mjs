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

  it('supports both pre-activation readiness and already-enabled initial-import hygiene', () => {
    expectScript("['0', '1'].includes(automationState)");
    expectScript('tenant_import_preflight_automation_state_invalid');
    expectScript("automationState === '1'");
    expectScript("'enabled_hygiene'");
    expectScript("'activation_readiness'");
    expect(script).not.toContain('tenant_import_preflight_requires_automation_off');
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

  it('keeps activation readiness strict while treating normal work as transient after enablement', () => {
    expectScript('const activationUnsafe =');
    expectScript('summary.undispatchedCandidates !== 0');
    expectScript('summary.dueScanOrRetryJobs !== 0');
    expectScript('summary.dueFinalizeJobs !== 0');
    expectScript('summary.activeImportJobs !== 0');
    expectScript('Object.values(summary.queueBacklogs).some');
    expectScript('const enabledHygieneUnsafe =');
    expectScript('summary.leftoverDisposableTenants !== 0');
    expectScript('DLQ_QUEUES.some');
    expectScript('automationEnabled ? enabledHygieneUnsafe : activationUnsafe');
    expectScript('tenant_import_preflight_not_clean');
  });

  it('publishes mode-aware evidence without claiming an enabled system must be switched off', () => {
    expectWorkflow("jq -e '.automationEnabled == true'");
    expectWorkflow('Initial import enabled; DLQs + disposable-canary hygiene clean');
    expectWorkflow('no automation state changed');
    expect(workflow).not.toContain('leave tenant import automation OFF');
  });

  it('publishes only aggregate operational counts, not tenant or supplier identifiers', () => {
    const output = script.slice(script.indexOf('const summary ='));
    expect(output).not.toContain('source_url');
    expect(output).not.toContain('tenant_id');
    expect(output).not.toContain('worker_script_name');
    expect(output).not.toContain('d1_database_id');
  });
});
