-- Final atomic storefront activation after all isolated-runtime/domain gates are green.

CREATE TABLE IF NOT EXISTS tenant_publish_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_publish_jobs_tenant
  ON tenant_publish_jobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_publish_jobs_due
  ON tenant_publish_jobs (status, next_attempt_at, created_at);
