const PRINCIPAL_ID_PATTERN = /^prn_[a-f0-9]{20}$/;
const ENTITLEMENT_TYPE = 'store_provisioning';
const FIRST_BETA_MAX_STORES = 1;

function entitlementError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function assertPrincipalId(principalId) {
  const normalized = String(principalId || '').trim();
  if (!PRINCIPAL_ID_PATTERN.test(normalized)) {
    throw entitlementError('invalid_account_principal', 500);
  }
  return normalized;
}

export async function touchAccountPrincipal(db, principalId) {
  const principal = assertPrincipalId(principalId);
  await db
    .prepare(
      `INSERT INTO account_principals (principal_id, first_seen_at, last_seen_at)
       VALUES (?1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(principal_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP`
    )
    .bind(principal)
    .run();
}

async function activeEntitlementRow(db, principalId) {
  const principal = assertPrincipalId(principalId);
  return db
    .prepare(
      `SELECT entitlement_id, source, max_stores, expires_at
         FROM account_entitlements
        WHERE principal_id=?1
          AND entitlement_type=?2
          AND status='active'
          AND datetime(expires_at) > CURRENT_TIMESTAMP
        LIMIT 1`
    )
    .bind(principal, ENTITLEMENT_TYPE)
    .first();
}

async function ownedStoreCount(db, principalId) {
  const principal = assertPrincipalId(principalId);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM tenant_memberships
        WHERE principal_id=?1 AND status='active' AND role='owner'`
    )
    .bind(principal)
    .first();
  return Math.max(0, Number(row?.total || 0));
}

export async function readStoreEntitlements(db, principalId) {
  const [entitlement, usedStores] = await Promise.all([
    activeEntitlementRow(db, principalId),
    ownedStoreCount(db, principalId)
  ]);
  const maxStores = entitlement ? Number(entitlement.max_stores || 0) : 0;
  const remainingStores = Math.max(0, maxStores - usedStores);
  return {
    canCreateStore: Boolean(entitlement && remainingStores > 0),
    maxStores,
    usedStores,
    remainingStores
  };
}

export async function requireStoreCreationEntitlement(db, principalId) {
  const entitlement = await activeEntitlementRow(db, principalId);
  if (!entitlement) throw entitlementError('store_creation_not_entitled', 403);
  if (Number(entitlement.max_stores) !== FIRST_BETA_MAX_STORES) {
    throw entitlementError('store_entitlement_misconfigured', 503);
  }
  const usedStores = await ownedStoreCount(db, principalId);
  if (usedStores >= FIRST_BETA_MAX_STORES) {
    throw entitlementError('store_limit_reached', 409);
  }
  return {
    entitlementId: entitlement.entitlement_id,
    maxStores: FIRST_BETA_MAX_STORES
  };
}

export function storeCreationSlotStatement(db, { principalId, entitlementId, tenantId }) {
  const principal = assertPrincipalId(principalId);
  const entitlement = String(entitlementId || '').trim();
  const tenant = String(tenantId || '').trim();
  if (!/^ent_[a-f0-9]{20}$/.test(entitlement) || !/^t_[a-f0-9]{20}$/.test(tenant)) {
    throw entitlementError('store_entitlement_misconfigured', 503);
  }

  return db
    .prepare(
      `INSERT INTO account_store_creation_slots
        (principal_id, slot_number, entitlement_id, tenant_id, reserved_at)
       VALUES (
         ?1,
         1,
         (
           SELECT entitlement_id
             FROM account_entitlements
            WHERE entitlement_id=?2
              AND principal_id=?1
              AND entitlement_type='store_provisioning'
              AND status='active'
              AND max_stores=1
              AND datetime(expires_at) > CURRENT_TIMESTAMP
            LIMIT 1
         ),
         ?3,
         CURRENT_TIMESTAMP
       )`
    )
    .bind(principal, entitlement, tenant);
}
