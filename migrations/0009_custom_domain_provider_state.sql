-- Provider-neutral state for customer-owned storefront domains.
-- The hostname itself is control-plane business data; provider API credentials remain runtime secrets.

CREATE TABLE IF NOT EXISTS tenant_domain_provider_state (
  domain_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cloudflare' CHECK (provider IN ('cloudflare')),
  provider_hostname_id TEXT UNIQUE,
  provider_status TEXT NOT NULL DEFAULT 'pending',
  ssl_status TEXT NOT NULL DEFAULT 'pending',
  cname_target TEXT,
  ownership_txt_name TEXT,
  ownership_txt_value TEXT,
  ssl_txt_name TEXT,
  ssl_txt_value TEXT,
  ssl_http_url TEXT,
  ssl_http_body TEXT,
  last_checked_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES tenant_domains(domain_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_domain_provider_state_tenant
  ON tenant_domain_provider_state (tenant_id, provider_status, ssl_status);

CREATE TABLE IF NOT EXISTS tenant_domain_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('provision', 'refresh', 'delete')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES tenant_domains(domain_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_domain_jobs_pending
  ON tenant_domain_jobs (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_domain_jobs_active_operation
  ON tenant_domain_jobs (domain_id, operation)
  WHERE status IN ('pending', 'running');
