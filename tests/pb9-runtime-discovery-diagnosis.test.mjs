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
    ...overrides
  };
}

describe('PB9 runtime discovery diagnosis', () => {
  it('matches the production runtime discovery predicates', () => {
    const evaluation = evaluateRuntimeDiscovery(discoverable());
    expect(evaluation.discoverable).toBe(true);
    expect(Object.values(evaluation.predicates).every(Boolean)).toBe(true);
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
    expect(JSON.stringify(evidence)).not.toMatch(
      /t_[a-f0-9]{20}|prn_[a-f0-9]{20}|worker_script|yupoo\.com|d1_database_id/i
    );
  });

  it('sanitizes unexpected state strings', () => {
    const evaluation = evaluateRuntimeDiscovery(
      discoverable({ provisioning_status: 'unsafe value with spaces' })
    );
    expect(evaluation.state.provisioningStatus).toBe('none');
    expect(evaluation.predicates.provisioningAtDomain).toBe(false);
  });
});
