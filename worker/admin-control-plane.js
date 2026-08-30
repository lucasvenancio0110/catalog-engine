import { AdminAuthError, authenticateAdminRequest } from './admin-auth.js';
import {
  attachTenantDomain,
  disconnectTenantDomain,
  readTenantDomain,
  requestTenantDomainRefresh
} from './admin-domain.js';
import {
  SupplierSourceValidationError,
  buildWorkerTenantProvisioningPlan,
  buildWorkerTenantSourceConnection,
  publicWorkerProvisioningSummary,
  publicWorkerTenantSourceSummary
} from './control-plane-plan.js';
import {
  createTenantSyncReplayRequest,
  readTenantSyncOperations
} from './tenant-sync-replay.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const MUTATING_ROLES = new Set(['owner', 'admin']);
const MAX_JSON_BODY_BYTES = 32_768;

function adminJson(payload, status = 200) {
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

async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('json_body_required'), { status: 415, code: 'json_body_required' });
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    throw Object.assign(new Error('request_body_too_large'), { status: 413, code: 'request_body_too_large' });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw Object.assign(new Error('request_body_too_large'), { status: 413, code: 'request_body_too_large' });
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400, code: 'invalid_json' });
  }
}

function requireDatabase(env) {
  if (!env.CATALOG_DB) {
    throw Object.assign(new Error('control_plane_database_unbound'), {
      status: 503,
      code: 'control_plane_database_unbound'
    });
  }
  return env.CATALOG_DB;
}

async function membershipFor(db, tenantId, principalId) {
  return db
    .prepare(
      `SELECT role, status
         FROM tenant_memberships
        WHERE tenant_id = ?1 AND principal_id = ?2 AND status = 'active'
        LIMIT 1`
    )
    .bind(tenantId, principalId)
    .first();
}

async function requireMembership(db, tenantId, principalId, { mutate = false } = {}) {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw Object.assign(new Error('store_not_found'), { status: 404, code: 'store_not_found' });
  }
  const membership = await membershipFor(db, tenantId, principalId);
  if (!membership) {
    throw Object.assign(new Error('store_not_found'), { status: 404, code: 'store_not_found' });
  }
  if (mutate && !MUTATING_ROLES.has(membership.role)) {
    throw Object.assign(new Error('insufficient_role'), { status: 403, code: 'insufficient_role' });
  }
  return membership;
}

function domainFromRow(row) {
  if (!row?.domain_hostname) return null;
  return {
    hostname: row.domain_hostname,
    status: row.domain_status || 'pending',
    domainType: 'custom'
  };
}

function publicOperationalError(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/https?:\/\/|yupoo|credential|password|secret|token/i.test(text)) return 'operation_failed';
  return text.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

async function listStores(db, principalId) {
  const result = await db
    .prepare(
      `SELECT t.tenant_id, t.slug, t.display_name, t.status AS tenant_status,
              p.store_name, p.theme_key, p.setup_status,
              m.role,
              d.hostname AS domain_hostname, d.status AS domain_status
         FROM tenant_memberships m
         JOIN catalog_tenants t ON t.tenant_id = m.tenant_id
         LEFT JOIN tenant_store_profiles p ON p.tenant_id = t.tenant_id
         LEFT JOIN tenant_domains d ON d.domain_id = (
           SELECT d2.domain_id
             FROM tenant_domains d2
            WHERE d2.tenant_id = t.tenant_id
              AND d2.domain_type = 'custom'
              AND d2.status != 'disabled'
            ORDER BY CASE d2.status WHEN 'active' THEN 0 WHEN 'verifying' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                     d2.updated_at DESC
            LIMIT 1
         )
        WHERE m.principal_id = ?1 AND m.status = 'active'
        ORDER BY t.created_at DESC`
    )
    .bind(principalId)
    .all();

  return (result.results || []).map((row) => ({
    tenantId: row.tenant_id,
    slug: row.slug,
    storeName: row.store_name || row.display_name,
    role: row.role,
    tenantStatus: row.tenant_status,
    setupStatus: row.setup_status || 'draft',
    themeKey: row.theme_key || null,
    domain: domainFromRow(row)
  }));
}

function successfulInitialStep(stepKey) {
  return stepKey === 'tenant' || stepKey === 'profile';
}

async function persistNewStore(db, plan) {
  const statements = [];
  statements.push(
    db
      .prepare(
        `INSERT INTO catalog_tenants (tenant_id, slug, display_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id) DO UPDATE SET
           slug=excluded.slug,
           display_name=excluded.display_name,
           status=excluded.status,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(plan.tenant.tenantId, plan.tenant.slug, plan.tenant.displayName, plan.tenant.status)
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_store_profiles
          (tenant_id, store_name, currency, theme_key, setup_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id) DO UPDATE SET
           store_name=excluded.store_name,
           currency=excluded.currency,
           theme_key=excluded.theme_key,
           setup_status=excluded.setup_status,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        plan.profile.tenantId,
        plan.profile.storeName,
        plan.profile.currency,
        plan.profile.themeKey,
        plan.profile.setupStatus
      )
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_catalog_instances
          (tenant_id, data_plane_key, status, schema_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id) DO UPDATE SET data_plane_key=excluded.data_plane_key, updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        plan.dataPlane.tenantId,
        plan.dataPlane.dataPlaneKey,
        plan.dataPlane.status,
        plan.dataPlane.schemaVersion
      )
  );
  if (plan.domain) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_domains
            (domain_id, tenant_id, hostname, domain_type, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'custom', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(domain_id) DO UPDATE SET hostname=excluded.hostname, status='pending', last_error=NULL, updated_at=CURRENT_TIMESTAMP`
        )
        .bind(plan.domain.domainId, plan.domain.tenantId, plan.domain.hostname)
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_memberships
          (membership_id, tenant_id, principal_id, role, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'owner', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, principal_id) DO UPDATE SET role='owner', status='active', updated_at=CURRENT_TIMESTAMP`
      )
      .bind(plan.membership.membershipId, plan.membership.tenantId, plan.membership.principalId)
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_provisioning_runs
          (provisioning_id, tenant_id, idempotency_key, requested_by_principal_id, status, current_step, context_json, started_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'source', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(provisioning_id) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        plan.provisioning.provisioningId,
        plan.provisioning.tenantId,
        plan.provisioning.idempotencyKey,
        plan.provisioning.requestedByPrincipalId
      )
  );
  for (const step of plan.provisioning.steps) {
    const complete = successfulInitialStep(step.stepKey);
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_provisioning_steps
            (provisioning_id, step_key, status, attempt_count, started_at, finished_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
           ON CONFLICT(provisioning_id, step_key) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`
        )
        .bind(
          plan.provisioning.provisioningId,
          step.stepKey,
          complete ? 'success' : 'pending',
          complete ? 1 : 0,
          complete ? new Date().toISOString() : null,
          complete ? new Date().toISOString() : null
        )
    );
  }
  const auditMetadata = JSON.stringify({
    provisioningId: plan.provisioning.provisioningId,
    slug: plan.tenant.slug
  });
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, ?2, 'tenant.provision.requested', 'tenant', ?1, ?3, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND principal_id=?2 AND action='tenant.provision.requested' AND metadata_json=?3
          )`
      )
      .bind(plan.tenant.tenantId, plan.membership.principalId, auditMetadata)
  );
  await db.batch(statements);
}

function storeCreationSummary(plan) {
  const summary = publicWorkerProvisioningSummary(plan);
  summary.status = 'running';
  summary.currentStep = 'source';
  summary.steps = summary.steps.map((step) => ({
    ...step,
    status: successfulInitialStep(step.stepKey) ? 'success' : 'pending'
  }));
  return summary;
}

async function onboardingState(db, tenantId) {
  const store = await db
    .prepare(
      `SELECT t.tenant_id, t.slug, t.display_name, t.status AS tenant_status,
              p.store_name, p.theme_key, p.currency, p.setup_status,
              i.status AS data_plane_status, i.schema_version
         FROM catalog_tenants t
         LEFT JOIN tenant_store_profiles p ON p.tenant_id=t.tenant_id
         LEFT JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
        WHERE t.tenant_id=?1
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
  if (!store) return null;

  const run = await db
    .prepare(
      `SELECT provisioning_id, status, current_step, started_at, finished_at, last_error, created_at
         FROM tenant_provisioning_runs
        WHERE tenant_id=?1
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
  const steps = run
    ? await db
        .prepare(
          `SELECT step_key, status, attempt_count, started_at, finished_at, last_error
             FROM tenant_provisioning_steps
            WHERE provisioning_id=?1
            ORDER BY rowid ASC`
        )
        .bind(run.provisioning_id)
        .all()
    : { results: [] };
  const source = await db
    .prepare(
      `SELECT provider, source_key, status, sync_strategy, last_health_at, last_success_at, last_error
         FROM tenant_source_connections
        WHERE tenant_id=?1 AND status!='disabled'
        ORDER BY created_at ASC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
  const domain = await readTenantDomain(db, tenantId);

  return {
    tenantId: store.tenant_id,
    slug: store.slug,
    storeName: store.store_name || store.display_name,
    tenantStatus: store.tenant_status,
    setupStatus: store.setup_status || 'draft',
    themeKey: store.theme_key || null,
    currency: store.currency || 'BRL',
    dataPlane: {
      status: store.data_plane_status || 'provisioning',
      schemaVersion: Number(store.schema_version || 0)
    },
    domain,
    source: source
      ? {
          provider: source.provider,
          sourceKey: source.source_key,
          status: source.status,
          syncStrategy: source.sync_strategy,
          lastHealthAt: source.last_health_at || null,
          lastSuccessAt: source.last_success_at || null,
          lastError: publicOperationalError(source.last_error)
        }
      : null,
    provisioning: run
      ? {
          provisioningId: run.provisioning_id,
          status: run.status,
          currentStep: run.current_step,
          startedAt: run.started_at || null,
          finishedAt: run.finished_at || null,
          lastError: publicOperationalError(run.last_error),
          steps: (steps.results || []).map((step) => ({
            stepKey: step.step_key,
            status: step.status,
            attemptCount: Number(step.attempt_count || 0),
            startedAt: step.started_at || null,
            finishedAt: step.finished_at || null,
            lastError: publicOperationalError(step.last_error)
          }))
        }
      : null
  };
}

async function persistSourceConnection(db, tenantId, principalId, plan) {
  const existing = await db
    .prepare(
      `SELECT source_url
         FROM supplier_sources
        WHERE tenant_id=?1 AND source_key=?2
        LIMIT 1`
    )
    .bind(tenantId, plan.connection.sourceKey)
    .first();
  if (existing?.source_url && existing.source_url !== plan.privateSource.canonicalUrl) {
    const imported = await db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM supplier_album_index
          WHERE tenant_id=?1 AND source_key=?2`
      )
      .bind(tenantId, plan.connection.sourceKey)
      .first();
    if (Number(imported?.total || 0) > 0) {
      throw Object.assign(new Error('source_change_requires_reset'), {
        status: 409,
        code: 'source_change_requires_reset'
      });
    }
  }

  const run = await db
    .prepare(
      `SELECT provisioning_id
         FROM tenant_provisioning_runs
        WHERE tenant_id=?1
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();

  const statements = [
    db
      .prepare(
        `INSERT INTO supplier_sources
          (tenant_id, source_key, provider, source_url, status, sync_strategy, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, source_key) DO UPDATE SET
           provider=excluded.provider,
           source_url=excluded.source_url,
           status='active',
           sync_strategy=excluded.sync_strategy,
           last_error=NULL,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        tenantId,
        plan.connection.sourceKey,
        plan.connection.provider,
        plan.privateSource.canonicalUrl,
        plan.connection.syncStrategy
      ),
    db
      .prepare(
        `INSERT INTO tenant_source_connections
          (connection_id, tenant_id, provider, source_key, source_locator_ref, status, sync_strategy, last_health_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, source_key) DO UPDATE SET
           provider=excluded.provider,
           source_locator_ref=excluded.source_locator_ref,
           status='active',
           sync_strategy=excluded.sync_strategy,
           last_health_at=CURRENT_TIMESTAMP,
           last_error=NULL,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        plan.connection.connectionId,
        tenantId,
        plan.connection.provider,
        plan.connection.sourceKey,
        plan.connection.sourceLocatorRef,
        plan.connection.syncStrategy
      )
  ];

  if (run?.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success',
                  attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                  finished_at=CURRENT_TIMESTAMP,
                  last_error=NULL,
                  metadata_json=?1,
                  updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?2 AND step_key='source'`
        )
        .bind(
          JSON.stringify({
            provider: plan.connection.provider,
            sourceKey: plan.connection.sourceKey,
            scopeKind: plan.privateSource.scopeKind
          }),
          run.provisioning_id
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running',
                  current_step=CASE
                    WHEN current_step IN ('tenant','profile','source') THEN 'data_plane'
                    ELSE current_step
                  END,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
                  last_error=NULL,
                  updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2`
        )
        .bind(run.provisioning_id, tenantId)
    );
  }

  const auditMetadata = JSON.stringify({
    provider: plan.connection.provider,
    sourceKey: plan.connection.sourceKey,
    scopeKind: plan.privateSource.scopeKind
  });
  statements.push(
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, ?2, 'tenant.source.connected', 'source_connection', ?3, ?4, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND principal_id=?2 AND action='tenant.source.connected' AND target_id=?3 AND metadata_json=?4
          )`
      )
      .bind(tenantId, principalId, plan.connection.connectionId, auditMetadata)
  );

  await db.batch(statements);
}

function errorResponse(error) {
  if (error instanceof AdminAuthError) return adminJson({ error: error.code }, error.status);
  if (error instanceof SupplierSourceValidationError) return adminJson({ error: error.code }, 422);
  if (error?.name === 'ZodError') return adminJson({ error: 'invalid_request' }, 400);
  if (error?.status && error?.code) return adminJson({ error: error.code }, error.status);
  const message = String(error?.message || error);
  if (/UNIQUE constraint failed: catalog_tenants\.slug/i.test(message)) {
    return adminJson({ error: 'store_slug_unavailable' }, 409);
  }
  if (/UNIQUE constraint failed: tenant_domains\.hostname/i.test(message)) {
    return adminJson({ error: 'domain_unavailable' }, 409);
  }
  console.error('admin_control_plane_failed', message);
  return adminJson({ error: 'admin_temporarily_unavailable' }, 503);
}

export async function handleAdminApi(request, env, { fetchImpl = fetch } = {}) {
  try {
    const auth = await authenticateAdminRequest(request, env, { fetchImpl });
    const db = requireDatabase(env);
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/session' && request.method === 'GET') {
      return adminJson({
        principalId: auth.principalId,
        tokenExpiresAt: auth.expiresAt,
        stores: await listStores(db, auth.principalId)
      });
    }

    if (url.pathname === '/api/admin/stores' && request.method === 'GET') {
      return adminJson({ items: await listStores(db, auth.principalId) });
    }

    if (url.pathname === '/api/admin/stores' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const plan = await buildWorkerTenantProvisioningPlan({
        ...body,
        ownerPrincipalId: auth.principalId
      });
      await persistNewStore(db, plan);
      if (plan.domain) {
        await attachTenantDomain(db, {
          tenantId: plan.tenant.tenantId,
          principalId: auth.principalId,
          hostname: plan.domain.hostname
        });
      }
      return adminJson({ store: storeCreationSummary(plan) }, 201);
    }

    const onboardingMatch = url.pathname.match(
      /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/onboarding$/
    );
    if (onboardingMatch && request.method === 'GET') {
      const tenantId = onboardingMatch[1];
      const membership = await requireMembership(db, tenantId, auth.principalId);
      const state = await onboardingState(db, tenantId);
      if (!state) return adminJson({ error: 'store_not_found' }, 404);
      return adminJson({ ...state, role: membership.role });
    }

    const sourceMatch = url.pathname.match(/^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/source$/);
    if (sourceMatch && request.method === 'POST') {
      const tenantId = sourceMatch[1];
      await requireMembership(db, tenantId, auth.principalId, { mutate: true });
      const body = await readJsonBody(request);
      const plan = await buildWorkerTenantSourceConnection(
        {
          tenantId,
          sourceKey: body.sourceKey || 'primary',
          sourceUrl: body.sourceUrl,
          syncStrategy: body.syncStrategy || 'incremental'
        },
        { fetchImpl }
      );
      await persistSourceConnection(db, tenantId, auth.principalId, plan);
      return adminJson({ source: publicWorkerTenantSourceSummary(plan) }, 200);
    }

    const syncOperationsMatch = url.pathname.match(
      /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/sync\/operations$/
    );
    if (syncOperationsMatch && request.method === 'GET') {
      const tenantId = syncOperationsMatch[1];
      await requireMembership(db, tenantId, auth.principalId);
      return adminJson(await readTenantSyncOperations(db, tenantId));
    }

    const syncReplayMatch = url.pathname.match(
      /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/sync\/replays$/
    );
    if (syncReplayMatch && request.method === 'POST') {
      const tenantId = syncReplayMatch[1];
      await requireMembership(db, tenantId, auth.principalId, { mutate: true });
      const body = await readJsonBody(request);
      const replay = await createTenantSyncReplayRequest(db, {
        ...body,
        tenantId,
        requestedByPrincipalId: auth.principalId
      });
      await db
        .prepare(
          `INSERT INTO tenant_audit_log
            (tenant_id,principal_id,action,target_type,target_id,metadata_json,created_at)
           SELECT ?1,?2,'tenant.sync.replay.requested','sync_replay',?3,?4,CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
              SELECT 1 FROM tenant_audit_log
               WHERE tenant_id=?1 AND principal_id=?2
                 AND action='tenant.sync.replay.requested' AND target_id=?3
            )`
        )
        .bind(
          tenantId,
          auth.principalId,
          replay.replayId,
          JSON.stringify({ runId: replay.runId, phase: replay.phase })
        )
        .run();
      return adminJson({ replay }, 202);
    }

    const domainRefreshMatch = url.pathname.match(
      /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/domain\/refresh$/
    );
    if (domainRefreshMatch && request.method === 'POST') {
      const tenantId = domainRefreshMatch[1];
      await requireMembership(db, tenantId, auth.principalId, { mutate: true });
      const domain = await requestTenantDomainRefresh(db, {
        tenantId,
        principalId: auth.principalId
      });
      return adminJson({ domain }, 202);
    }

    const domainMatch = url.pathname.match(/^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/domain$/);
    if (domainMatch) {
      const tenantId = domainMatch[1];
      if (request.method === 'GET') {
        await requireMembership(db, tenantId, auth.principalId);
        return adminJson({ domain: await readTenantDomain(db, tenantId) });
      }
      if (request.method === 'PUT') {
        await requireMembership(db, tenantId, auth.principalId, { mutate: true });
        const body = await readJsonBody(request);
        const domain = await attachTenantDomain(db, {
          tenantId,
          principalId: auth.principalId,
          hostname: body.hostname
        });
        return adminJson({ domain }, 202);
      }
      if (request.method === 'DELETE') {
        await requireMembership(db, tenantId, auth.principalId, { mutate: true });
        await disconnectTenantDomain(db, { tenantId, principalId: auth.principalId });
        return adminJson({ domain: null }, 202);
      }
    }

    return adminJson({ error: 'not_found' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
