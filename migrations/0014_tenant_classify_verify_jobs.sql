-- Durable post-import classification and verification checkpoints.

CREATE TABLE IF NOT EXISTS tenant_classification_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
  classifier_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
  automatic_count INTEGER NOT NULL DEFAULT 0 CHECK (automatic_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_classification_jobs_version
  ON tenant_classification_jobs (tenant_id, classifier_version, classifier_key);
CREATE INDEX IF NOT EXISTS idx_tenant_classification_jobs_due
  ON tenant_classification_jobs (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS tenant_verification_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  classifier_version INTEGER NOT NULL CHECK (classifier_version >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
  finding_count INTEGER NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
  findings_json TEXT NOT NULL DEFAULT '[]',
  next_attempt_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_verification_jobs_version
  ON tenant_verification_jobs (tenant_id, classifier_version);
CREATE INDEX IF NOT EXISTS idx_tenant_verification_jobs_due
  ON tenant_verification_jobs (status, next_attempt_at, created_at);
