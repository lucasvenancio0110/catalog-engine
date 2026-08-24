-- Low-cardinality operational authorization for recurring tenant synchronization.
-- Absence of a row is disabled. Existing tenant/source pairs are never enrolled
-- implicitly, and high-cardinality supplier/catalog state remains in tenant D1.

CREATE TABLE IF NOT EXISTS tenant_sync_enrollments (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('enrolled', 'disabled')),
  cohort_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_key),
  FOREIGN KEY (tenant_id, source_key)
    REFERENCES supplier_sources(tenant_id, source_key) ON DELETE CASCADE,
  CHECK (
    cohort_key IS NULL OR (
      length(cohort_key) BETWEEN 1 AND 48
      AND cohort_key = lower(cohort_key)
      AND cohort_key NOT GLOB '*[^a-z0-9_-]*'
    )
  ),
  CHECK (status <> 'enrolled' OR cohort_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_tenant_sync_enrollments_cohort
  ON tenant_sync_enrollments (status, cohort_key, tenant_id, source_key);
