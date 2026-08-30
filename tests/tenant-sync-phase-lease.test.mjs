import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimTenantSyncPhaseLease,
  failTenantSyncPhaseLease,
  reclaimExpiredTenantSyncPhaseLeases,
  releaseTenantSyncPhaseLease,
  safeTenantSyncErrorCode,
  tenantSyncFailureIsRetryable,
  tenantSyncRecoveryDelayMinutes
} from '../worker/tenant-sync-phase-lease.js';

const databases = [];
const job = {
  import_id: 'imp_0123456789abcdefabcd',
  tenant_id: 't_0123456789abcdefabcd',
  source_key: 'primary',
  mode: 'incremental',
  state_revision: 0
};

class Statement {
  constructor(statement, params = []) {
    this.statement = statement;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.statement, params);
  }

  run() {
    const result = this.statement.run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }

  first() {
    return this.statement.get(...this.params) || null;
  }
}

function database({ status = 'queued', phase = 'scan', recoveryAttempts = 0 } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE tenant_import_jobs (
      import_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      state_revision INTEGER NOT NULL DEFAULT 0,
      recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
      last_failure_phase TEXT,
      phase_lease_kind TEXT,
      phase_lease_token TEXT,
      phase_lease_until TEXT,
      scan_lease_until TEXT,
      finalize_lease_until TEXT,
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_delivery_at TEXT,
      candidate_classified_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite.prepare(`INSERT INTO tenant_import_jobs
    (import_id,tenant_id,source_key,mode,status,phase,recovery_attempt_count)
    VALUES (?,?,?,?,?,?,?)`).run(
    job.import_id,
    job.tenant_id,
    job.source_key,
    job.mode,
    status,
    phase,
    recoveryAttempts
  );
  return {
    sqlite,
    d1: {
      prepare(sql) {
        return new Statement(sqlite.prepare(sql));
      }
    }
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D10 phase lease ownership', () => {
  it('reclaims an expired lease while the old owner fails closed on token and revision CAS', async () => {
    const { sqlite, d1 } = database();
    const first = await claimTenantSyncPhaseLease(d1, job, 'scan');
    expect(first).toMatchObject({ kind: 'scan', revision: 1, recoveryAttemptCount: 0 });

    expect(await claimTenantSyncPhaseLease(d1, { ...job, state_revision: 1 }, 'scan')).toBeNull();
    sqlite.prepare(`UPDATE tenant_import_jobs
      SET phase_lease_until=datetime(CURRENT_TIMESTAMP,'-1 minute')`).run();

    expect(
      await claimTenantSyncPhaseLease(
        d1,
        { ...job, state_revision: 1 },
        'scan'
      )
    ).toBeNull();
    expect(await reclaimExpiredTenantSyncPhaseLeases(d1)).toBe(1);
    expect(sqlite.prepare(`SELECT status,state_revision,recovery_attempt_count,
      last_failure_phase,last_error_code,next_attempt_at,phase_lease_token
      FROM tenant_import_jobs`).get()).toMatchObject({
      status: 'failed',
      state_revision: 2,
      recovery_attempt_count: 1,
      last_failure_phase: 'scan',
      last_error_code: 'tenant_sync_scan_lease_expired',
      phase_lease_token: null
    });

    sqlite.prepare(`UPDATE tenant_import_jobs
      SET status='queued',next_attempt_at=NULL,state_revision=state_revision+1`).run();
    const second = await claimTenantSyncPhaseLease(
      d1,
      { ...job, state_revision: 3 },
      'scan'
    );
    expect(second).toMatchObject({ kind: 'scan', revision: 4, recoveryAttemptCount: 1 });
    expect(second.token).not.toBe(first.token);

    expect(await releaseTenantSyncPhaseLease(d1, job, first)).toBe(false);
    expect(
      await failTenantSyncPhaseLease(d1, job, first, 'tenant_sync_scan_failed')
    ).toBe(false);

    expect(
      await failTenantSyncPhaseLease(d1, job, second, 'tenant_sync_scan_failed')
    ).toBe(true);
    const row = sqlite.prepare(`SELECT status,state_revision,recovery_attempt_count,
      last_failure_phase,last_error_code,next_attempt_at,phase_lease_token
      FROM tenant_import_jobs`).get();
    expect(row).toMatchObject({
      status: 'failed',
      state_revision: 5,
      recovery_attempt_count: 2,
      last_failure_phase: 'scan',
      last_error_code: 'tenant_sync_scan_failed',
      phase_lease_token: null
    });
    expect(row.next_attempt_at).toBeTruthy();
  });

  it('stops retrying after the bounded recovery threshold', async () => {
    const { sqlite, d1 } = database({
      status: 'details',
      phase: 'details',
      recoveryAttempts: 3
    });
    const ownership = await claimTenantSyncPhaseLease(
      d1,
      { ...job, recovery_attempt_count: 3 },
      'classification'
    );
    expect(ownership.recoveryAttemptCount).toBe(3);
    expect(
      await failTenantSyncPhaseLease(
        d1,
        job,
        ownership,
        'sync_candidate_classification_failed'
      )
    ).toBe(true);
    expect(
      sqlite.prepare(`SELECT recovery_attempt_count,next_attempt_at FROM tenant_import_jobs`).get()
    ).toEqual({ recovery_attempt_count: 4, next_attempt_at: null });
  });

  it('records the durable classification checkpoint exactly when the lease owner succeeds', async () => {
    const { sqlite, d1 } = database({ status: 'details', phase: 'details' });
    const ownership = await claimTenantSyncPhaseLease(d1, job, 'classification');
    expect(
      await releaseTenantSyncPhaseLease(d1, job, ownership, {
        resetRecovery: true,
        markClassified: true
      })
    ).toBe(true);
    const row = sqlite.prepare(`SELECT candidate_classified_at,state_revision,
      phase_lease_token FROM tenant_import_jobs`).get();
    expect(row.candidate_classified_at).toBeTruthy();
    expect(row.state_revision).toBe(2);
    expect(row.phase_lease_token).toBeNull();
  });

  it('keeps backoff and error metadata bounded and safe', () => {
    expect([1, 2, 3, 4].map(tenantSyncRecoveryDelayMinutes)).toEqual([2, 4, 8, 16]);
    expect(tenantSyncFailureIsRetryable('verification', 'sync_candidate_verification_failed'))
      .toBe(true);
    expect(tenantSyncFailureIsRetryable('scan', 'sync_stage_count_mismatch')).toBe(true);
    expect(tenantSyncFailureIsRetryable('classification', 'sync_candidate_cei_count_mismatch'))
      .toBe(true);
    expect(tenantSyncFailureIsRetryable('verification', 'sync_candidate_verify_public_source_leak'))
      .toBe(false);
    expect(safeTenantSyncErrorCode('https://private.example/token=secret')).toBe(
      'tenant_sync_operation_failed'
    );
  });
});
