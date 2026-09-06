import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sanitizePb9RuntimeDiagnostic } from '../scripts/cloudflare-pb9-runtime-diagnostic.mjs';

function row(overrides = {}) {
  return {
    target_count: 1,
    target_is_default: 0,
    provisioning_at_domain: 1,
    provisioning_runnable: 1,
    instance_provisioning: 1,
    schema_ready: 1,
    database_active: 1,
    worker_active: 1,
    data_plane_locator_present: 1,
    verification_success: 1,
    candidate_eligible: 1,
    runtime_kind_catalog: 0,
    runtime_status_verified: 0,
    runtime_status_error: 0,
    runtime_version_current: 0,
    runtime_job_present: 1,
    runtime_job_pending: 0,
    runtime_job_running: 0,
    runtime_job_staged: 0,
    runtime_job_failed: 1,
    runtime_job_success: 0,
    runtime_job_attempt_count: 2,
    runtime_job_due: 0,
    runtime_job_retry_deferred: 1,
    eligible_candidates_total: 3,
    eligible_candidates_ahead: 2,
    due_runtime_jobs_total: 1,
    provider_last_error_code: 'tenant_runtime_smoke_failed',
    runtime_job_last_error_code: 'tenant_runtime_smoke_failed',
    ...overrides
  };
}

describe('PB9 runtime diagnostic evidence', () => {
  it('keeps only safe booleans, counts and controlled error codes', () => {
    const evidence = sanitizePb9RuntimeDiagnostic('CROCCODILOS', row());
    expect(evidence).toEqual({
      pb9RuntimeDiagnostic: 'safe',
      merchant: 'CROCCODILOS',
      targetUnique: true,
      targetIsDefault: false,
      gates: {
        provisioningAtDomain: true,
        provisioningRunnable: true,
        instanceProvisioning: true,
        schemaReady: true,
        databaseActive: true,
        workerActive: true,
        dataPlaneLocatorPresent: true,
        verificationSuccess: true,
        candidateEligible: true,
        runtimeKindCatalog: false,
        runtimeStatusVerified: false,
        runtimeStatusError: false,
        runtimeVersionCurrent: false
      },
      queue: {
        jobPresent: true,
        jobPending: false,
        jobRunning: false,
        jobStaged: false,
        jobFailed: true,
        jobSuccess: false,
        jobAttemptCount: 2,
        jobDue: false,
        jobRetryDeferred: true,
        eligibleCandidatesTotal: 3,
        eligibleCandidatesAhead: 2,
        dueRuntimeJobsTotal: 1
      },
      errors: {
        provider: 'tenant_runtime_smoke_failed',
        job: 'tenant_runtime_smoke_failed'
      }
    });
    expect(JSON.stringify(evidence)).not.toMatch(
      /t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|worker_script|d1_database|workers\.dev|yupoo\.com/i
    );
  });

  it('drops malformed or identifier-bearing error values', () => {
    const evidence = sanitizePb9RuntimeDiagnostic(
      'CROCCODILOS',
      row({
        provider_last_error_code: 'https://private.example/runtime',
        runtime_job_last_error_code: 'tenant runtime failed t_1234567890abcdef1234'
      })
    );
    expect(evidence.errors).toEqual({ provider: null, job: null });
  });

  it('diagnoses the same candidate gates used by the production runtime runner', async () => {
    const [diagnostic, runner] = await Promise.all([
      readFile(new URL('../scripts/cloudflare-pb9-runtime-diagnostic.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../worker/tenant-runtime-runner.js', import.meta.url), 'utf8')
    ]);
    for (const clause of [
      "r.current_step='domain'",
      "r.status IN ('running','failed','blocked')",
      "i.status='provisioning'",
      'i.schema_version >= 3',
      "p.database_status='active'",
      "p.worker_status='active'",
      'p.d1_database_id IS NOT NULL',
      "p.runtime_kind!='catalog'",
      "p.runtime_status!='verified'"
    ]) {
      expect(runner).toContain(clause);
      expect(diagnostic).toContain(clause);
    }
    expect(diagnostic).toContain('eligible_candidates_ahead');
    expect(diagnostic).toContain('due_runtime_jobs_total');
  });
});
