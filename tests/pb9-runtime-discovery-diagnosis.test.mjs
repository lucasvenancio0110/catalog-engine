import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  evaluateRuntimeDiscovery,
  safeRuntimeDiscoveryEvidence
} from '../scripts/cloudflare-pb9-runtime-discovery-diagnosis.mjs';

function discoverable(overrides = {}) {
  return {
    tenant_count: 1,
    provisioning_status: 'running',
    provisioning_step: 'domain',
    instance_status: 'provisioning',
    schema_version: 3,
    database_status: 'active',
    worker_status: 'active',
    verification_status: 'success',
    finding_count: 0,
    runtime_status: 'pending',
    runtime_version: 0,
    target_runtime_version: 1,
    runtime_job_status: null,
    eligible_candidates_total: 1,
    eligible_candidates_ahead: 0,
    exhausted_eligible_jobs: 0,
    oldest_candidate_exhausted: 0,
    oldest_candidate_job_status: null,
    oldest_candidate_job_attempt_count: 0,
    oldest_candidate_job_last_error_code: null,
    oldest_candidate_job_due: 0,
    due_runtime_jobs: 0,
    ...overrides
  };
}

describe('PB9 runtime discovery diagnosis', () => {
  it('matches the production runtime discovery predicates', () => {
    const evaluation = evaluateRuntimeDiscovery(discoverable());
    expect(evaluation.discoverable).toBe(true);
    expect(Object.values(evaluation.predicates).every(Boolean)).toBe(true);
    expect(evaluation.scheduling).toEqual({
      eligibleCandidates: 1,
      candidatesAhead: 0,
      selectionRank: 1,
      exhaustedEligibleJobs: 0,
      oldestCandidateExhausted: false,
      oldestCandidateJobStatus: 'none',
      oldestCandidateJobAttemptCount: 0,
      oldestCandidateJobLastErrorCode: 'none',
      oldestCandidateJobDue: false,
      dueRuntimeJobs: 0
    });
  });

  it('identifies each bounded discovery blocker independently', () => {
    for (const override of [
      { tenant_count: 0 },
      { provisioning_step: 'verification' },
      { provisioning_status: 'success' },
      { instance_status: 'ready' },
      { schema_version: 2 },
      { database_status: 'pending' },
      { worker_status: 'pending' },
      { verification_status: 'failed' },
      { finding_count: 1 },
      { runtime_job_status: 'running' }
    ]) {
      expect(evaluateRuntimeDiscovery(discoverable(override)).discoverable).toBe(false);
    }
  });

  it('does not require work when the runtime is already current and verified', () => {
    const evaluation = evaluateRuntimeDiscovery(
      discoverable({ runtime_status: 'verified', runtime_version: 1 })
    );
    expect(evaluation.predicates.runtimeNeedsWork).toBe(false);
    expect(evaluation.discoverable).toBe(false);
    expect(evaluation.scheduling.selectionRank).toBe(0);
  });

  it('reports bounded candidate ordering and oldest-job starvation signals', () => {
    const evaluation = evaluateRuntimeDiscovery(
      discoverable({
        eligible_candidates_total: 4,
        eligible_candidates_ahead: 2,
        exhausted_eligible_jobs: 1,
        oldest_candidate_exhausted: 1,
        oldest_candidate_job_status: 'failed',
        oldest_candidate_job_attempt_count: 3,
        oldest_candidate_job_last_error_code: 'runtime_upload_failed',
        oldest_candidate_job_due: 1,
        due_runtime_jobs: 1
      })
    );
    expect(evaluation.scheduling).toEqual({
      eligibleCandidates: 4,
      candidatesAhead: 2,
      selectionRank: 3,
      exhaustedEligibleJobs: 1,
      oldestCandidateExhausted: true,
      oldestCandidateJobStatus: 'failed',
      oldestCandidateJobAttemptCount: 3,
      oldestCandidateJobLastErrorCode: 'runtime_upload_failed',
      oldestCandidateJobDue: true,
      dueRuntimeJobs: 1
    });
  });

  it('emits only bounded safe state without private identifiers', () => {
    const evidence = safeRuntimeDiscoveryEvidence(
      'CROCCODILOS',
      evaluateRuntimeDiscovery(discoverable())
    );
    expect(evidence.pb9RuntimeDiscovery).toBe('discoverable');
    expect(evidence.state).toEqual({
      provisioningStatus: 'running',
      provisioningStep: 'domain',
      instanceStatus: 'provisioning',
      schemaVersion: 3,
      databaseStatus: 'active',
      workerStatus: 'active',
      verificationStatus: 'success',
      verificationFindings: 0,
      runtimeStatus: 'pending',
      runtimeVersion: 0,
      targetRuntimeVersion: 1,
      runtimeJobStatus: 'none'
    });
    expect(evidence.scheduling.selectionRank).toBe(1);
    expect(JSON.stringify(evidence)).not.toMatch(
      /t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|worker_script|workers\.dev|yupoo\.com|d1_database_id/i
    );
  });

  it('sanitizes unexpected state and oldest-job error strings', () => {
    const evaluation = evaluateRuntimeDiscovery(
      discoverable({
        provisioning_status: 'unsafe value with spaces',
        oldest_candidate_job_last_error_code: 'unsafe error with spaces'
      })
    );
    expect(evaluation.state.provisioningStatus).toBe('none');
    expect(evaluation.scheduling.oldestCandidateJobLastErrorCode).toBe('none');
    expect(evaluation.predicates.provisioningAtDomain).toBe(false);
  });

  it('keeps runtime-version and automatic-attempt limits aligned with the production runner', async () => {
    const [diagnostic, runner] = await Promise.all([
      readFile(new URL('../scripts/cloudflare-pb9-runtime-discovery-diagnosis.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../worker/tenant-runtime-runner.js', import.meta.url), 'utf8')
    ]);
    expect(diagnostic).toContain("import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js'");
    expect(diagnostic).toContain('const RUNTIME_MAX_AUTOMATIC_ATTEMPTS = 6;');
    expect(runner).toContain('const MAX_AUTOMATIC_ATTEMPTS = 6;');
    expect(diagnostic).toContain('eligible_candidates_ahead');
    expect(diagnostic).toContain('oldest_candidate_exhausted');
    expect(diagnostic).toContain('oldest_candidate_job_last_error_code');
    expect(diagnostic).toContain('oldest_candidate_job_due');
  });
});
