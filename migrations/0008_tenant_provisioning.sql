-- Durable, resumable tenant onboarding/provisioning state.
-- These control-plane tables remain low-volume and portable to a future CONTROL_DB.

CREATE TABLE IF NOT EXISTS tenant_source_connections (
  connection_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_key TEXT NOT NULL DEFAULT 'primary',
  source_locator_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validating', 'active', 'error', 'paused', 'disabled')),
  sync_strategy TEXT NOT NULL DEFAULT 'incremental' CHECK (sync_strategy IN ('incremental', 'full')),
  last_health_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source_key),
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_source_connections_tenant
  ON tenant_source_connections (tenant_id, status);

CREATE TABLE IF NOT EXISTS tenant_provisioning_runs (
  provisioning_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by_principal_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'blocked', 'success', 'failed', 'cancelled')),
  current_step TEXT NOT NULL DEFAULT 'tenant' CHECK (current_step IN ('tenant', 'profile', 'domain', 'data_plane', 'source', 'migrations', 'import', 'classify', 'verify', 'publish', 'complete')),
  context_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_provisioning_runs_tenant
  ON tenant_provisioning_runs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_provisioning_runs_status
  ON tenant_provisioning_runs (status, updated_at);

CREATE TABLE IF NOT EXISTS tenant_provisioning_steps (
  provisioning_id TEXT NOT NULL,
  step_key TEXT NOT NULL CHECK (step_key IN ('tenant', 'profile', 'domain', 'data_plane', 'source', 'migrations', 'import', 'classify', 'verify', 'publish')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped', 'blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provisioning_id, step_key),
  FOREIGN KEY (provisioning_id) REFERENCES tenant_provisioning_runs(provisioning_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_provisioning_steps_status
  ON tenant_provisioning_steps (status, updated_at);
