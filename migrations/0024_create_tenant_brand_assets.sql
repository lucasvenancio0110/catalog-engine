-- PB4 tenant-owned branding asset registry.
-- Public profile data stores only the Catalog Engine-owned opaque asset path.
-- Cloudflare Images provider identifiers remain private control-plane state.

CREATE TABLE IF NOT EXISTS tenant_brand_assets (
  asset_id TEXT PRIMARY KEY CHECK (
    length(asset_id) = 24
    AND substr(asset_id, 1, 4) = 'bas_'
    AND substr(asset_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  tenant_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind = 'logo'),
  provider TEXT NOT NULL CHECK (provider = 'cloudflare_images'),
  provider_asset_id TEXT NOT NULL UNIQUE,
  public_path TEXT NOT NULL UNIQUE CHECK (public_path GLOB '/brand-assets/bas_*.webp'),
  mime_type TEXT NOT NULL CHECK (mime_type = 'image/webp'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'deleted')),
  created_by_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_brand_assets_tenant
  ON tenant_brand_assets (tenant_id, asset_kind, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_brand_assets_active_logo
  ON tenant_brand_assets (tenant_id, asset_kind)
  WHERE status = 'active';
