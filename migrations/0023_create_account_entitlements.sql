-- PB2 account + first-beta provisioning entitlement.
-- This remains in the transitional control plane and is portable to a future CONTROL_DB.
-- The first beta deliberately supports one owned store per account. A later billing slice may
-- broaden the quota model with a forward-only migration; historical applied migrations stay immutable.

CREATE TABLE IF NOT EXISTS account_principals (
  principal_id TEXT PRIMARY KEY CHECK (
    length(principal_id) = 24
    AND substr(principal_id, 1, 4) = 'prn_'
    AND substr(principal_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_entitlements (
  entitlement_id TEXT PRIMARY KEY CHECK (
    length(entitlement_id) = 24
    AND substr(entitlement_id, 1, 4) = 'ent_'
    AND substr(entitlement_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
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
  event_id TEXT PRIMARY KEY CHECK (
    length(event_id) = 24
    AND substr(event_id, 1, 4) = 'eev_'
    AND substr(event_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
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

CREATE TRIGGER IF NOT EXISTS trg_account_entitlement_events_no_update
BEFORE UPDATE ON account_entitlement_events
BEGIN
  SELECT RAISE(ABORT, 'entitlement_event_append_only');
END;

CREATE TRIGGER IF NOT EXISTS trg_account_entitlement_events_no_delete
BEFORE DELETE ON account_entitlement_events
BEGIN
  SELECT RAISE(ABORT, 'entitlement_event_append_only');
END;

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

-- Only principals that have been authenticated through the portal are subject to this gate.
-- Internal fixture/canary principals that never enter account_principals keep their existing
-- control-plane path. Portal POST /api/admin/stores touches account_principals before delegating.
CREATE TRIGGER IF NOT EXISTS trg_portal_owner_entitlement_guard
BEFORE INSERT ON tenant_memberships
WHEN NEW.role = 'owner'
 AND NEW.status = 'active'
 AND EXISTS (SELECT 1 FROM account_principals WHERE principal_id = NEW.principal_id)
BEGIN
  SELECT RAISE(ABORT, 'store_creation_not_entitled')
   WHERE NOT EXISTS (
     SELECT 1
       FROM account_entitlements e
      WHERE e.principal_id = NEW.principal_id
        AND e.entitlement_type = 'store_provisioning'
        AND e.status = 'active'
        AND e.max_stores = 1
        AND datetime(e.expires_at) > CURRENT_TIMESTAMP
   );

  SELECT RAISE(ABORT, 'store_limit_reached')
   WHERE (
     SELECT COUNT(*)
       FROM tenant_memberships m
      WHERE m.principal_id = NEW.principal_id
        AND m.role = 'owner'
        AND m.status = 'active'
   ) >= 1;
END;

-- The slot is written inside the same D1 transaction as tenant/profile/membership creation.
-- Its primary key is a second concurrency barrier: two simultaneous first-store attempts cannot
-- both consume the one-store pilot allowance even if they both passed an earlier read check.
CREATE TRIGGER IF NOT EXISTS trg_portal_owner_entitlement_slot
AFTER INSERT ON tenant_memberships
WHEN NEW.role = 'owner'
 AND NEW.status = 'active'
 AND EXISTS (SELECT 1 FROM account_principals WHERE principal_id = NEW.principal_id)
BEGIN
  INSERT INTO account_store_creation_slots
    (principal_id, slot_number, entitlement_id, tenant_id, reserved_at)
  SELECT NEW.principal_id, 1, e.entitlement_id, NEW.tenant_id, CURRENT_TIMESTAMP
    FROM account_entitlements e
   WHERE e.principal_id = NEW.principal_id
     AND e.entitlement_type = 'store_provisioning'
     AND e.status = 'active'
     AND e.max_stores = 1
     AND datetime(e.expires_at) > CURRENT_TIMESTAMP
   LIMIT 1;
END;
