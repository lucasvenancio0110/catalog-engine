-- Separate physical D1 schema migration work from provider resource provisioning.

CREATE TABLE IF NOT EXISTS tenant_data_plane_migration_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  target_schema_version INTEGER NOT NULL CHECK (target_schema_version >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_migration_jobs_due
  ON tenant_data_plane_migration_jobs (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_data_plane_migration_jobs_active_version
  ON tenant_data_plane_migration_jobs (tenant_id, target_schema_version)
  WHERE status IN ('pending', 'running');
