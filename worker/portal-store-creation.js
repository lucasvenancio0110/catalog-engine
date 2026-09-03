import { requireStoreCreationEntitlement } from './account-entitlements.js';
import { buildWorkerTenantProvisioningPlan } from './control-plane-plan.js';

function portalStoreJson(payload, status = 200) {
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

function publicProvisioning(id, status, step) {
  return id
    ? {
        id,
        status: status || 'pending',
        step: step || 'tenant'
      }
    : null;
}

export function merchantCreatedStoreFromDelegate(store) {
  if (!store || typeof store !== 'object') return null;
  const tenantId = String(store.tenantId || '').trim();
  const slug = String(store.slug || '').trim();
  const title = String(store.title || store.storeName || '').trim();
  const currency = String(store.currency || '').trim().toUpperCase();
  if (!tenantId || !slug || !title || !currency) return null;
  return {
    tenantId,
    slug,
    title,
    currency,
    status: String(store.status || 'pending'),
    currentStep: String(store.currentStep || 'tenant'),
    latestProvisioning: publicProvisioning(
      store.provisioningId || store.latestProvisioning?.id,
      store.status || store.latestProvisioning?.status,
      store.currentStep || store.latestProvisioning?.step
    ),
    initialImport: {
      status: 'blocked',
      reason: 'onboarding_source_required'
    }
  };
}

function merchantCreatedStoreFromRow(row) {
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    title: row.store_name,
    currency: row.currency,
    status: row.status,
    currentStep: row.provisioning_step || 'tenant',
    latestProvisioning: publicProvisioning(
      row.provisioning_id,
      row.provisioning_status,
      row.provisioning_step
    ),
    initialImport: {
      status: 'blocked',
      reason: 'onboarding_source_required'
    }
  };
}

async function loadExactCreatedStore(db, plan, principalId) {
  const row = await db
    .prepare(
      `SELECT
         t.tenant_id,
         t.slug,
         t.currency,
         t.status,
         p.store_name,
         pr.provisioning_id,
         pr.status AS provisioning_status,
         pr.current_step AS provisioning_step
       FROM catalog_tenants t
       JOIN tenant_memberships m
         ON m.tenant_id=t.tenant_id
        AND m.principal_id=?1
        AND m.role='owner'
        AND m.status='active'
       JOIN tenant_profiles p ON p.tenant_id=t.tenant_id
       LEFT JOIN tenant_provisioning_runs pr
         ON pr.tenant_id=t.tenant_id
        AND pr.provisioning_id=?2
       WHERE t.tenant_id=?3
         AND t.slug=?4
       LIMIT 1`
    )
    .bind(
      principalId,
      plan.provisioning.provisioningId,
      plan.tenant.tenantId,
      plan.tenant.slug
    )
    .first();
  return merchantCreatedStoreFromRow(row);
}

async function planPortalStoreRequest(request, principalId) {
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  try {
    return await buildWorkerTenantProvisioningPlan({
      storeName: body?.name,
      slug: body?.slug,
      ownerPrincipalId: principalId,
      currency: body?.currency,
      themeKey: body?.themeKey,
      customDomain: body?.customDomain || null
    });
  } catch {
    return null;
  }
}

async function responseErrorCode(response) {
  try {
    const payload = await response.clone().json();
    return String(payload?.error || '').trim();
  } catch {
    return '';
  }
}

export async function handlePortalStoreCreation({ request, env, ctx, principalId, delegate }) {
  const plan = await planPortalStoreRequest(request, principalId);
  if (!plan) return delegate(request, env, ctx);

  const replay = await loadExactCreatedStore(env.CATALOG_DB, plan, principalId);
  if (replay) {
    return portalStoreJson({ store: replay, replayed: true }, 200);
  }

  await requireStoreCreationEntitlement(env.CATALOG_DB, principalId);
  const response = await delegate(request, env, ctx);

  if (response.status === 201) {
    try {
      const payload = await response.clone().json();
      const store = merchantCreatedStoreFromDelegate(payload?.store);
      if (store) return portalStoreJson({ store, replayed: false }, 201);
    } catch {
      // Preserve the authoritative control-plane response if it is unexpectedly non-JSON.
    }
    return response;
  }

  if (response.status === 409 && (await responseErrorCode(response)) === 'store_limit_reached') {
    const concurrentReplay = await loadExactCreatedStore(env.CATALOG_DB, plan, principalId);
    if (concurrentReplay) {
      return portalStoreJson({ store: concurrentReplay, replayed: true }, 200);
    }
  }

  return response;
}
