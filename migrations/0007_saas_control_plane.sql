-- Transitional control-plane tables.
-- Today they live beside tenant #0001 in CATALOG_DB so the model can be exercised.
-- The schema is intentionally portable to a future dedicated CONTROL_DB while each
-- storefront catalog remains isolated in its own tenant data plane.

CREATE TABLE IF NOT EXISTS catalog_theme_presets (
  theme_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'preview', 'retired')),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO catalog_theme_presets (theme_key, display_name, version, status, capabilities_json) VALUES
  ('stadium', 'Stadium', 1, 'active', '{"hero":true,"clubRail":true,"leagueRail":true}'),
  ('premium-dark', 'Premium Dark', 1, 'active', '{"hero":true,"clubRail":true,"leagueRail":true}'),
  ('clean', 'Clean', 1, 'active', '{"hero":true,"clubRail":true,"leagueRail":true}'),
  ('street', 'Street', 1, 'preview', '{"hero":true,"clubRail":true,"leagueRail":false}'),
  ('minimal', 'Minimal', 1, 'preview', '{"hero":false,"clubRail":true,"leagueRail":true}');

CREATE TABLE IF NOT EXISTS tenant_store_profiles (
  tenant_id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  logo_path TEXT,
  whatsapp TEXT,
  instagram TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  theme_key TEXT NOT NULL DEFAULT 'premium-dark',
  primary_color TEXT,
  secondary_color TEXT,
  home_sections_json TEXT NOT NULL DEFAULT '["new-arrivals","clubs","leagues","retro"]',
  setup_status TEXT NOT NULL DEFAULT 'draft' CHECK (setup_status IN ('draft', 'configuring', 'ready', 'published', 'suspended')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (theme_key) REFERENCES catalog_theme_presets(theme_key)
);

INSERT OR IGNORE INTO tenant_store_profiles (
  tenant_id, store_name, theme_key, setup_status
) VALUES (
  't_00000000000000000001', 'Catalog Engine Demo', 'premium-dark', 'published'
);

CREATE TABLE IF NOT EXISTS tenant_catalog_instances (
  tenant_id TEXT PRIMARY KEY,
  data_plane_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready', 'migrating', 'error', 'disabled')),
  schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version >= 0),
  last_migration_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO tenant_catalog_instances (
  tenant_id, data_plane_key, status, schema_version
) VALUES (
  't_00000000000000000001', 'catalog-engine-default', 'ready', 7
);

CREATE TABLE IF NOT EXISTS tenant_domains (
  domain_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  domain_type TEXT NOT NULL CHECK (domain_type IN ('platform_subdomain', 'custom')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'active', 'error', 'disabled')),
  verification_token_hash TEXT,
  verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant
  ON tenant_domains (tenant_id, status);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  membership_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, principal_id),
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_principal
  ON tenant_memberships (principal_id, status);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  principal_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant
  ON tenant_audit_log (tenant_id, created_at DESC);

-- Detail retry state prevents permanently incomplete supplier albums from being
-- fetched on every incremental run. The processor can apply bounded backoff.
ALTER TABLE supplier_album_index ADD COLUMN detail_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_album_index ADD COLUMN detail_retry_after TEXT;
ALTER TABLE supplier_album_index ADD COLUMN detail_last_error TEXT;
