-- M7D10 control-plane recovery, replay ownership and safe operational state.
-- Supplier evidence and high-cardinality candidate state remain in each tenant D1.

ALTER TABLE tenant_import_jobs ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0
  CHECK (state_revision >= 0);
ALTER TABLE tenant_import_jobs ADD COLUMN recovery_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (recovery_attempt_count >= 0);
ALTER TABLE tenant_import_jobs ADD COLUMN last_failure_phase TEXT
  CHECK (last_failure_phase IS NULL OR last_failure_phase IN (
    'scan', 'detail', 'classification', 'verification', 'finalization'
  ));
ALTER TABLE tenant_import_jobs ADD COLUMN phase_lease_kind TEXT
  CHECK (phase_lease_kind IS NULL OR phase_lease_kind IN (
    'scan', 'classification', 'verification', 'finalization'
  ));
ALTER TABLE tenant_import_jobs ADD COLUMN phase_lease_token TEXT;
ALTER TABLE tenant_import_jobs ADD COLUMN phase_lease_until TEXT;
ALTER TABLE tenant_import_jobs ADD COLUMN last_recovery_at TEXT;
ALTER TABLE tenant_import_jobs ADD COLUMN last_delivery_at TEXT;
ALTER TABLE tenant_import_jobs ADD COLUMN candidate_classified_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_import_jobs_recovery_due
  ON tenant_import_jobs (status, next_attempt_at, recovery_attempt_count, updated_at)
  WHERE mode='incremental' AND status='failed';

CREATE INDEX IF NOT EXISTS idx_tenant_import_jobs_phase_lease
  ON tenant_import_jobs (phase_lease_kind, phase_lease_until)
  WHERE phase_lease_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_sync_replay_requests (
  replay_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  import_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN (
    'scan', 'detail', 'classification', 'verification', 'finalization'
  )),
  expected_job_revision INTEGER NOT NULL CHECK (expected_job_revision >= 0),
  expected_authority_revision INTEGER NOT NULL CHECK (expected_authority_revision >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'success', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  replayed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (replayed_item_count >= 0),
  next_attempt_at TEXT,
  lease_token TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  requested_by_principal_id TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (import_id, phase, expected_job_revision, expected_authority_revision),
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_key)
    REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE,
  FOREIGN KEY (import_id) REFERENCES tenant_import_jobs(import_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_sync_replay_due
  ON tenant_sync_replay_requests (status, next_attempt_at, lease_until, created_at);

CREATE INDEX IF NOT EXISTS idx_tenant_sync_replay_tenant
  ON tenant_sync_replay_requests (tenant_id, created_at DESC);
