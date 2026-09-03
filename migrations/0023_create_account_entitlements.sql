-- PB2 account + first-beta provisioning entitlement.
-- This remains in the transitional control plane and is portable to a future CONTROL_DB.
-- The first beta deliberately supports one owned store per account. A later billing slice may
-- broaden the quota model with a forward-only migration; historical migrations stay immutable.

CREATE TABLE IF NOT EXISTS account_principals (
  principal_id TEXT PRIMARY KEY CHECK (principal_id GLOB 'prn_[0-9a-f]*' AND length(principal_id) = 24),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  entitlement_id TEXT PRIMARY KEY CHECK (entitlement_id GLOB 'ent_[0-9a-f]*' AND length(entitlement_id) = 24),
  principal_id TEXT NOT NULL,
  entitlement_type TEXT NOT NULL DEFAULT 'store_provisioning' CHECK (entitlement_type = 'store_provisioning'),
  source TEXT NOT NULL CHECK (source IN ('pilot_grant', 'billing')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  max_stores INTEGER NOT NULL DEFAULT 1 CHECK (max_stores = 1),
  granted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (principal_id, entitlement_type),
  FOREIGN KEY (principal_id) REFERENCES account_principals(principal_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_active
  ON account_entitlements (principal_id, status, expires_at);

CREATE TABLE IF NOT EXISTS account_entitlement_events (
  event_id TEXT PRIMARY KEY CHECK (event_id GLOB 'eev_[0-9a-f]*' AND length(event_id) = 24),
  entitlement_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'renewed', 'revoked')),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  max_stores INTEGER NOT NULL CHECK (max_stores = 1),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entitlement_id) REFERENCES account_entitlements(entitlement_id) ON DELETE RESTRICT,
  FOREIGN KEY (principal_id) REFERENCES account_principals(principal_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_entitlement_events_principal
  ON account_entitlement_events (principal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_store_creation_slots (
  principal_id TEXT NOT NULL,
  slot_number INTEGER NOT NULL CHECK (slot_number = 1),
  entitlement_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL UNIQUE,
  reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (principal_id, slot_number),
  FOREIGN KEY (principal_id) REFERENCES account_principals(principal_id) ON DELETE RESTRICT,
  FOREIGN KEY (entitlement_id) REFERENCES account_entitlements(entitlement_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id) REFERENCES catalog_tenants(tenant_id) ON DELETE RESTRICT
);
