-- PB9 authenticated private preview session authority.
-- Sessions are short-lived control-plane capabilities created only after authenticated
-- membership + verified tenant runtime/catalog readiness has been revalidated server-side.
-- Only SHA-256 token hashes are persisted; raw browser tokens exist solely in an HttpOnly
-- host-only cookie on app.catalogoengine.com and never become tenant/runtime locators.

CREATE TABLE IF NOT EXISTS tenant_private_preview_sessions (
  session_hash TEXT PRIMARY KEY CHECK (
    length(session_hash) = 64
    AND session_hash NOT GLOB '*[^0-9a-f]*'
  ),
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (principal_id) REFERENCES account_principals(principal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_private_preview_sessions_principal
  ON tenant_private_preview_sessions (principal_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_tenant_private_preview_sessions_tenant
  ON tenant_private_preview_sessions (tenant_id, expires_at);
