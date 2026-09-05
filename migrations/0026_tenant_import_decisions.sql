-- PB6: merchant import scope/decision authority.
-- The first beta supports one truthful provider-neutral decision: import the full
-- currently connected source. Private source locator refs bind a decision to the
-- exact source revision but are never projected to the merchant.

CREATE TABLE IF NOT EXISTS tenant_import_decisions (
  tenant_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_locator_ref TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind = 'full_connected_source'),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status = 'confirmed'),
  authority TEXT NOT NULL CHECK (authority IN ('merchant', 'preexisting_import')),
  decided_by_principal_id TEXT,
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_key),
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  CHECK (
    (authority = 'merchant' AND decided_by_principal_id IS NOT NULL)
    OR (authority = 'preexisting_import' AND decided_by_principal_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tenant_import_decisions_confirmed
  ON tenant_import_decisions (status, decision_kind, updated_at);

-- Preserve already-running/completed initial-import reality without inventing a
-- merchant click. Existing initial jobs remain authoritative and are labeled as a
-- compatibility decision. Fresh sources without an initial job remain blocked
-- until an explicit PB6 merchant decision is recorded.
INSERT OR IGNORE INTO tenant_import_decisions (
  tenant_id,
  source_key,
  source_locator_ref,
  decision_kind,
  status,
  authority,
  decided_by_principal_id,
  confirmed_at,
  created_at,
  updated_at
)
SELECT
  j.tenant_id,
  j.source_key,
  c.source_locator_ref,
  'full_connected_source',
  'confirmed',
  'preexisting_import',
  NULL,
  COALESCE(j.created_at, CURRENT_TIMESTAMP),
  COALESCE(j.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM tenant_import_jobs j
JOIN tenant_source_connections c
  ON c.tenant_id=j.tenant_id
 AND c.source_key=j.source_key
 AND c.status='active'
WHERE j.mode='initial';
