import { handlePortalConstructionPreviewRequest } from './portal-construction-preview.js';
import { handlePortalImportDecisionRequest } from './portal-import-decision.js';
import { stableOpaqueId } from './runtime-identity.js';

const DEFAULT_TENANT_ID = 't_00000000000000000001';
const SOURCE_KEY = 'primary';
const DECISION_KIND = 'full_connected_source';
const USEFUL_PRODUCT_THRESHOLD = 12;
const POLL_MS = 75;
const PROOF_TIMEOUT_MS = 60_000;
const SAFE_TOKEN = /^[a-f0-9]{64}$/;
const SAFE_SEED = /^[A-Za-z0-9:._-]{8,240}$/;
const PRIVATE_EVIDENCE = /https?:\/\/|yupoo|source_url|sourceurl|sourceitem|listingfingerprint|loc_[a-f0-9]{8,}|d1_database|worker_script|dispatch_namespace/i;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}

function safeFailure(error) {
  const candidate = String(error?.message || '').trim();
  return /^ic2_proof_[a-z0-9_]{1,96}$/.test(candidate) ? candidate : 'ic2_proof_failed';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(env) {
  if (!env?.CATALOG_DB) throw new Error('ic2_proof_database_unbound');
  if (!env?.TENANT_INSTANT_SEED_QUEUE?.send) throw new Error('ic2_proof_queue_unbound');
  if (!env?.TENANT_CONSTRUCTION_STATE?.idFromName || !env?.TENANT_CONSTRUCTION_STATE?.get) {
    throw new Error('ic2_proof_construction_unbound');
  }
  if (!SAFE_TOKEN.test(String(env.IC2_PROOF_TOKEN || ''))) {
    throw new Error('ic2_proof_token_unconfigured');
  }
  if (!SAFE_SEED.test(String(env.IC2_PROOF_RUN_SEED || ''))) {
    throw new Error('ic2_proof_seed_unconfigured');
  }
}

async function fixtureIdentity(seed) {
  const tenantId = await stableOpaqueId('t', `ic2-proof:${seed}`);
  return {
    tenantId,
    principalId: await stableOpaqueId('prn', `ic2-proof:${seed}`),
    crossPrincipalId: await stableOpaqueId('prn', `ic2-proof-cross:${seed}`),
    membershipId: await stableOpaqueId('mem', `ic2-proof:${seed}`),
    connectionId: await stableOpaqueId('src', `ic2-proof:${seed}`),
    sourceLocatorRef: await stableOpaqueId('loc', `ic2-proof:${seed}`),
    dataPlaneKey: `ic2-proof-${tenantId.slice(2)}`,
    slug: `ic2-proof-${tenantId.slice(2)}`
  };
}

async function sourceAuthority(db, displayName) {
  const row = await db
    .prepare(
      `SELECT s.source_url
         FROM supplier_sources s
         JOIN catalog_tenants t ON t.tenant_id=s.tenant_id
        WHERE upper(t.display_name)=upper(?1)
          AND s.source_key=?2
          AND s.status='active'
        ORDER BY s.updated_at DESC
        LIMIT 1`
    )
    .bind(String(displayName || 'CROCCODILOS').trim(), SOURCE_KEY)
    .first();
  const sourceUrl = String(row?.source_url || '').trim();
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('ic2_proof_source_unavailable');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.x\.yupoo\.com$/i.test(parsed.hostname)
  ) {
    throw new Error('ic2_proof_source_invalid');
  }
  return parsed.href;
}

async function setupFixture(env, fixture, sourceUrl) {
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `INSERT INTO catalog_tenants
         (tenant_id,slug,display_name,status,created_at,updated_at)
       VALUES (?1,?2,'IC2 Production Proof','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.tenantId, fixture.slug),
    env.CATALOG_DB.prepare(
      `INSERT INTO tenant_store_profiles
         (tenant_id,store_name,currency,theme_key,setup_status,created_at,updated_at)
       VALUES (?1,'IC2 Production Proof','BRL','premium-dark','configuring',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.tenantId),
    env.CATALOG_DB.prepare(
      `INSERT INTO tenant_catalog_instances
         (tenant_id,data_plane_key,status,schema_version,created_at,updated_at)
       VALUES (?1,?2,'provisioning',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.tenantId, fixture.dataPlaneKey),
    env.CATALOG_DB.prepare(
      `INSERT INTO tenant_memberships
         (membership_id,tenant_id,principal_id,role,status,created_at,updated_at)
       VALUES (?1,?2,?3,'owner','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.membershipId, fixture.tenantId, fixture.principalId),
    env.CATALOG_DB.prepare(
      `INSERT INTO supplier_sources
         (tenant_id,source_key,provider,source_url,status,sync_strategy,removal_miss_threshold,created_at,updated_at)
       VALUES (?1,?2,'yupoo',?3,'active','incremental',3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.tenantId, SOURCE_KEY, sourceUrl),
    env.CATALOG_DB.prepare(
      `INSERT INTO tenant_source_connections
         (connection_id,tenant_id,provider,source_key,source_locator_ref,status,sync_strategy,last_health_at,created_at,updated_at)
       VALUES (?1,?2,'yupoo',?3,?4,'active','incremental',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    ).bind(fixture.connectionId, fixture.tenantId, SOURCE_KEY, fixture.sourceLocatorRef)
  ]);
}

function constructionStub(env, tenantId) {
  const id = env.TENANT_CONSTRUCTION_STATE.idFromName(tenantId);
  return env.TENANT_CONSTRUCTION_STATE.get(id);
}

async function projection(env, tenantId) {
  const response = await constructionStub(env, tenantId).fetch('https://construction.internal/projection');
  if (!response.ok) throw new Error('ic2_proof_projection_unavailable');
  const payload = await response.json().catch(() => null);
  if (
    Number(payload?.version) !== 1 ||
    !['empty', 'indexed'].includes(payload?.readiness) ||
    typeof payload?.ready !== 'boolean' ||
    payload?.complete !== false ||
    !Number.isInteger(payload?.productCount) ||
    !Array.isArray(payload?.products)
  ) {
    throw new Error('ic2_proof_projection_invalid');
  }
  return payload;
}

async function acceptDecision(env, fixture) {
  const request = new Request(
    `https://app.catalogoengine.com/api/admin/stores/${fixture.tenantId}/import-decision`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceKey: SOURCE_KEY, decisionKind: DECISION_KIND })
    }
  );
  const response = await handlePortalImportDecisionRequest(request, env, {
    authenticate: async () => ({ principalId: fixture.principalId })
  });
  const payload = await response.json().catch(() => null);
  if (
    response.status !== 200 ||
    payload?.decision?.status !== 'confirmed' ||
    payload?.decision?.authority !== 'merchant'
  ) {
    throw new Error('ic2_proof_decision_rejected');
  }
}

async function measureFastPath(env, fixture) {
  const started = performance.now();
  await acceptDecision(env, fixture);
  const accepted = performance.now();
  let firstIndexedMs = null;
  let readyMs = null;
  let last = null;

  while (performance.now() - started <= PROOF_TIMEOUT_MS) {
    last = await projection(env, fixture.tenantId);
    const elapsed = performance.now() - started;
    if (firstIndexedMs == null && last.productCount > 0) firstIndexedMs = Math.round(elapsed);
    if (last.ready === true) {
      readyMs = Math.round(elapsed);
      break;
    }
    await sleep(POLL_MS);
  }

  if (firstIndexedMs == null) throw new Error('ic2_proof_ttfi_timeout');
  if (readyMs == null) throw new Error('ic2_proof_ttfc_timeout');
  if (Number(last?.productCount || 0) < USEFUL_PRODUCT_THRESHOLD) {
    throw new Error('ic2_proof_ready_count_invalid');
  }

  return {
    decisionRoundTripMs: Math.round(accepted - started),
    ttfiMs: firstIndexedMs,
    ttfcMs: readyMs,
    productCount: Number(last.productCount),
    projection: last
  };
}

async function safePreview(env, tenantId, principalId) {
  const request = new Request(
    `https://app.catalogoengine.com/api/admin/stores/${tenantId}/construction-preview`,
    { method: 'GET' }
  );
  return handlePortalConstructionPreviewRequest(request, env, {
    authenticate: async () => ({ principalId })
  });
}

async function proveIsolation(env, fixture, measured) {
  const own = await safePreview(env, fixture.tenantId, fixture.principalId);
  const ownPayload = await own.json().catch(() => null);
  if (own.status !== 200 || ownPayload?.ready !== true) {
    throw new Error('ic2_proof_member_preview_failed');
  }
  const serialized = JSON.stringify(ownPayload);
  if (PRIVATE_EVIDENCE.test(serialized)) throw new Error('ic2_proof_private_leak');
  if (Number(ownPayload.productCount || 0) !== measured.productCount) {
    throw new Error('ic2_proof_projection_count_mismatch');
  }

  const cross = await safePreview(env, fixture.tenantId, fixture.crossPrincipalId);
  if (cross.status !== 404) throw new Error('ic2_proof_cross_tenant_not_closed');

  const defaultAccess = await safePreview(env, DEFAULT_TENANT_ID, fixture.principalId);
  if (defaultAccess.status !== 404) throw new Error('ic2_proof_default_not_closed');

  const anonymous = await fetch(
    `https://app.catalogoengine.com/api/admin/stores/${fixture.tenantId}/construction-preview`,
    { method: 'GET', redirect: 'manual' }
  );
  if (![401, 403].includes(anonymous.status)) throw new Error('ic2_proof_anonymous_not_closed');
  await anonymous.body?.cancel().catch(() => {});

  return {
    anonymousFailClosed: true,
    crossTenantFailClosed: true,
    defaultTenantFailClosed: true,
    privateIdentifiersExposed: false
  };
}

async function cleanupFixture(env, fixture) {
  if (!fixture?.tenantId) return;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM tenant_import_decisions WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM tenant_audit_log WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM tenant_source_connections WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM supplier_sources WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM tenant_memberships WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM tenant_catalog_instances WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM tenant_store_profiles WHERE tenant_id=?1').bind(fixture.tenantId),
    env.CATALOG_DB.prepare('DELETE FROM catalog_tenants WHERE tenant_id=?1').bind(fixture.tenantId)
  ]);
  await constructionStub(env, fixture.tenantId)
    .fetch('https://construction.internal/state', { method: 'DELETE' })
    .catch(() => null);
}

async function runProof(env) {
  requireEnv(env);
  const fixture = await fixtureIdentity(env.IC2_PROOF_RUN_SEED);
  let measured = null;
  try {
    const sourceUrl = await sourceAuthority(
      env.CATALOG_DB,
      env.IC2_PROOF_SOURCE_DISPLAY_NAME || 'CROCCODILOS'
    );
    await cleanupFixture(env, fixture);
    await setupFixture(env, fixture, sourceUrl);
    measured = await measureFastPath(env, fixture);
    const isolation = await proveIsolation(env, fixture, measured);
    return {
      ic2ProductionProof: 'passed',
      freshTenant: true,
      decisionRoundTripMs: measured.decisionRoundTripMs,
      ttfiMs: measured.ttfiMs,
      ttfcMs: measured.ttfcMs,
      productCount: measured.productCount,
      readinessThreshold: USEFUL_PRODUCT_THRESHOLD,
      ...isolation
    };
  } finally {
    await cleanupFixture(env, fixture).catch(() => null);
  }
}

export default {
  async fetch(request, env) {
    try {
      requireEnv(env);
      const url = new URL(request.url);
      if (url.pathname !== '/prove' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
      const authorization = String(request.headers.get('authorization') || '');
      if (authorization !== `Bearer ${env.IC2_PROOF_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      return json(await runProof(env));
    } catch (error) {
      return json({ ic2ProductionProof: 'failed', error: safeFailure(error) }, 500);
    }
  }
};

export const ic2ProductionProofCanaryContract = Object.freeze({
  readinessThreshold: USEFUL_PRODUCT_THRESHOLD,
  timeoutMs: PROOF_TIMEOUT_MS,
  pollMs: POLL_MS
});
