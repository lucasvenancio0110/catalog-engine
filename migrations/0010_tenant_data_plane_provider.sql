-- Physical tenant catalog isolation state.
-- The control plane tracks the Cloudflare resources assigned to one tenant without
-- exposing provider identifiers to the storefront or merchant-facing APIs.

CREATE TABLE IF NOT EXISTS tenant_data_plane_provider_state (
  tenant_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'cloudflare_wfp' CHECK (provider IN ('cloudflare_wfp')),
  dispatch_namespace TEXT NOT NULL,
  worker_script_name TEXT NOT NULL UNIQUE,
  d1_database_name TEXT NOT NULL UNIQUE,
  d1_database_id TEXT UNIQUE,
  worker_status TEXT NOT NULL DEFAULT 'pending' CHECK (worker_status IN ('pending', 'provisioning', 'active', 'error', 'disabled')),
  database_status TEXT NOT NULL DEFAULT 'pending' CHECK (database_status IN ('pending', 'provisioning', 'active', 'error', 'disabled')),
  worker_version TEXT,
  last_checked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_provider_status
  ON tenant_data_plane_provider_state (worker_status, database_status, updated_at);

CREATE TABLE IF NOT EXISTS tenant_data_plane_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('provision', 'reconcile', 'delete')),
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

CREATE INDEX IF NOT EXISTS idx_tenant_data_plane_jobs_due
  ON tenant_data_plane_jobs (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_data_plane_jobs_active_operation
  ON tenant_data_plane_jobs (tenant_id, operation)
  WHERE status IN ('pending', 'running');
