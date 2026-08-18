-- Stage and verify the full tenant catalog Worker separately from the bootstrap Worker.

ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'bootstrap'
    CHECK (runtime_kind IN ('bootstrap','catalog'));
ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN runtime_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (runtime_status IN ('pending','staging','staged','verified','error','disabled'));
ALTER TABLE tenant_data_plane_provider_state
  ADD COLUMN runtime_version INTEGER NOT NULL DEFAULT 0 CHECK (runtime_version >= 0);
ALTER TABLE tenant_data_plane_provider_state ADD COLUMN runtime_verified_at TEXT;
ALTER TABLE tenant_data_plane_provider_state ADD COLUMN runtime_last_error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_runtime_status
  ON tenant_data_plane_provider_state (runtime_status, runtime_version, updated_at);

CREATE TABLE IF NOT EXISTS tenant_runtime_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  target_runtime_version INTEGER NOT NULL CHECK (target_runtime_version >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','staged','success','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  staged_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_runtime_jobs_version
  ON tenant_runtime_jobs (tenant_id, target_runtime_version);
CREATE INDEX IF NOT EXISTS idx_tenant_runtime_jobs_due
  ON tenant_runtime_jobs (status, next_attempt_at, created_at);
