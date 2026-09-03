import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const DISPATCH_NAMESPACE = String(
  process.env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || 'catalog-engine-production'
).trim();
const ACTION = String(process.env.PILOT_ENTITLEMENT_ACTION || '').trim();
const PRINCIPAL_ID = String(process.env.PILOT_PRINCIPAL_ID || '').trim();
const EXPIRES_AT = String(process.env.PILOT_EXPIRES_AT || '').trim();
const REASON = String(process.env.PILOT_REASON || '').trim();
const ACTOR = `github:${String(process.env.GITHUB_ACTOR || '').trim()}`;
const GITHUB_REF = String(process.env.GITHUB_REF || '').trim();
const RUN_SEED = `${process.env.GITHUB_RUN_ID || 'manual'}:${process.env.GITHUB_RUN_ATTEMPT || '1'}`;

if (GITHUB_REF !== 'refs/heads/main') throw new Error('pilot_entitlement_requires_trusted_main');
if (!/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) throw new Error('pilot_entitlement_account_unconfigured');
if (API_TOKEN.length < 20) throw new Error('pilot_entitlement_token_unconfigured');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(DISPATCH_NAMESPACE)) {
  throw new Error('pilot_entitlement_dispatch_namespace_invalid');
}
if (!/^(grant|revoke)$/.test(ACTION)) throw new Error('pilot_entitlement_action_invalid');
if (!/^prn_[a-f0-9]{20}$/.test(PRINCIPAL_ID)) throw new Error('pilot_entitlement_principal_invalid');
if (!/^github:[A-Za-z0-9-]{1,39}$/.test(ACTOR)) throw new Error('pilot_entitlement_actor_invalid');
if (REASON.length < 5 || REASON.length > 160 || /[\r\n\t]/.test(REASON)) {
  throw new Error('pilot_entitlement_reason_invalid');
}

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const databaseId = String(
  wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
).trim();
if (!/^[a-f0-9-]{32,40}$/i.test(databaseId)) {
  throw new Error('pilot_entitlement_control_database_invalid');
}

function opaqueId(prefix, seed) {
  return `${prefix}_${createHash('sha256').update(`${prefix}:${seed}`).digest('hex').slice(0, 20)}`;
}

function platformConfig() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId
  };
}

async function batch(queries) {
  return queryD1Batch({ ...platformConfig(), batch: queries });
}

const principalRows = await batch([
  {
    sql: 'SELECT principal_id FROM account_principals WHERE principal_id=?1 LIMIT 1',
    params: [PRINCIPAL_ID]
  }
]);
if (!principalRows[0]?.results?.[0]?.principal_id) {
  throw new Error('pilot_entitlement_principal_not_registered');
}

const existingRows = await batch([
  {
    sql: `SELECT entitlement_id,status,max_stores,expires_at
            FROM account_entitlements
           WHERE principal_id=?1 AND entitlement_type='store_provisioning'
           LIMIT 1`,
    params: [PRINCIPAL_ID]
  }
]);
const existing = existingRows[0]?.results?.[0] || null;
const entitlementId = existing?.entitlement_id || opaqueId('ent', `${PRINCIPAL_ID}:store_provisioning`);
const eventId = opaqueId(
  'eev',
  `${RUN_SEED}:${ACTION}:${PRINCIPAL_ID}:${EXPIRES_AT || existing?.expires_at || 'none'}`
);

if (ACTION === 'grant') {
  const expires = Date.parse(EXPIRES_AT);
  const now = Date.now();
  const maximum = now + 366 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(expires) || expires <= now || expires > maximum) {
    throw new Error('pilot_entitlement_expiry_invalid');
  }
  const normalizedExpiry = new Date(expires).toISOString();
  const eventAction = existing ? 'renewed' : 'granted';

  await batch([
    {
      sql: `INSERT INTO account_entitlements
              (entitlement_id,principal_id,entitlement_type,source,status,max_stores,granted_by,reason,granted_at,expires_at,revoked_at,updated_at)
            VALUES (?1,?2,'store_provisioning','pilot_grant','active',1,?3,?4,CURRENT_TIMESTAMP,?5,NULL,CURRENT_TIMESTAMP)
            ON CONFLICT(principal_id,entitlement_type) DO UPDATE SET
              source='pilot_grant',status='active',max_stores=1,granted_by=excluded.granted_by,
              reason=excluded.reason,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=CURRENT_TIMESTAMP`,
      params: [entitlementId, PRINCIPAL_ID, ACTOR, REASON, normalizedExpiry]
    },
    {
      sql: `INSERT INTO account_entitlement_events
              (event_id,entitlement_id,principal_id,action,actor,reason,max_stores,expires_at,created_at)
            VALUES (?1,?2,?3,?4,?5,?6,1,?7,CURRENT_TIMESTAMP)`,
      params: [eventId, entitlementId, PRINCIPAL_ID, eventAction, ACTOR, REASON, normalizedExpiry]
    }
  ]);
  console.log(
    'pilot_entitlement_granted',
    JSON.stringify({ principalId: PRINCIPAL_ID, maxStores: 1, expiresAt: normalizedExpiry, action: eventAction })
  );
} else {
  if (!existing) throw new Error('pilot_entitlement_not_found');
  const currentExpiry = String(existing.expires_at || '').trim();
  if (!currentExpiry) throw new Error('pilot_entitlement_expiry_missing');

  await batch([
    {
      sql: `UPDATE account_entitlements
               SET status='revoked',revoked_at=CURRENT_TIMESTAMP,reason=?1,granted_by=?2,updated_at=CURRENT_TIMESTAMP
             WHERE entitlement_id=?3 AND principal_id=?4`,
      params: [REASON, ACTOR, entitlementId, PRINCIPAL_ID]
    },
    {
      sql: `INSERT INTO account_entitlement_events
              (event_id,entitlement_id,principal_id,action,actor,reason,max_stores,expires_at,created_at)
            VALUES (?1,?2,?3,'revoked',?4,?5,1,?6,CURRENT_TIMESTAMP)`,
      params: [eventId, entitlementId, PRINCIPAL_ID, ACTOR, REASON, currentExpiry]
    }
  ]);
  console.log(
    'pilot_entitlement_revoked',
    JSON.stringify({ principalId: PRINCIPAL_ID, maxStores: 1 })
  );
}
