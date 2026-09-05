-- PB4 production recovery: allow private Cloudflare R2 as the branding asset store.
-- Existing Cloudflare Images rows remain valid for backwards compatibility.

CREATE TABLE tenant_brand_assets_v2 (
  asset_id TEXT PRIMARY KEY CHECK (
    length(asset_id) = 24
    AND substr(asset_id, 1, 4) = 'bas_'
    AND substr(asset_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  tenant_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind = 'logo'),
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_images', 'cloudflare_r2')),
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

INSERT INTO tenant_brand_assets_v2 (
  asset_id, tenant_id, asset_kind, provider, provider_asset_id, public_path,
  mime_type, width, height, byte_size, status, created_by_principal_id, created_at, updated_at
)
SELECT
  asset_id, tenant_id, asset_kind, provider, provider_asset_id, public_path,
  mime_type, width, height, byte_size, status, created_by_principal_id, created_at, updated_at
FROM tenant_brand_assets;

DROP TABLE tenant_brand_assets;
ALTER TABLE tenant_brand_assets_v2 RENAME TO tenant_brand_assets;

CREATE INDEX idx_tenant_brand_assets_tenant
  ON tenant_brand_assets (tenant_id, asset_kind, status, created_at DESC);

CREATE UNIQUE INDEX idx_tenant_brand_assets_active_logo
  ON tenant_brand_assets (tenant_id, asset_kind)
  WHERE status = 'active';
