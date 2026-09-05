import { authenticateAdminRequest } from './admin-auth.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const MUTATING_ROLES = new Set(['owner', 'admin']);
const MAX_JSON_BODY_BYTES = 4_096;
const SOURCE_KEY = 'primary';
const DECISION_KIND = 'full_connected_source';

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

function decisionError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function publicError(error) {
  if (error?.status && error?.code) return json({ error: error.code }, error.status);
  console.error('portal_import_decision_failed', String(error?.message || error).slice(0, 120));
  return json({ error: 'import_decision_temporarily_unavailable' }, 503);
}

async function readJson(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) throw decisionError('json_body_required', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_JSON_BODY_BYTES) throw decisionError('request_body_too_large', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw decisionError('request_body_too_large', 413);
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw decisionError('invalid_json', 400);
  }
}

async function requireMembership(db, tenantId, principalId, { mutate = false } = {}) {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw decisionError('store_not_found', 404);
  const membership = await db
    .prepare(
      `SELECT role
         FROM tenant_memberships
        WHERE tenant_id=?1 AND principal_id=?2 AND status='active'
        LIMIT 1`
    )
    .bind(tenantId, principalId)
    .first();
  if (!membership) throw decisionError('store_not_found', 404);
  if (mutate && !MUTATING_ROLES.has(membership.role)) {
    throw decisionError('insufficient_role', 403);
  }
  return membership;
}

function publicDecision(row) {
  if (!row) return null;
  if (
    row.status !== 'confirmed' ||
    row.decision_kind !== DECISION_KIND ||
    !['merchant', 'preexisting_import'].includes(row.authority)
  ) {
    throw decisionError('import_decision_state_invalid', 502);
  }
  return {
    sourceKey: SOURCE_KEY,
    decisionKind: DECISION_KIND,
    status: 'confirmed',
    authority: row.authority,
    confirmedAt: row.confirmed_at || null
  };
}

async function activeConnection(db, tenantId) {
  return db
    .prepare(
      `SELECT provider, source_key, source_locator_ref, status
         FROM tenant_source_connections
        WHERE tenant_id=?1 AND source_key=?2 AND status='active'
        LIMIT 1`
    )
    .bind(tenantId, SOURCE_KEY)
    .first();
}

async function storedDecision(db, tenantId, sourceLocatorRef) {
  return db
    .prepare(
      `SELECT decision_kind, status, authority, confirmed_at
         FROM tenant_import_decisions
        WHERE tenant_id=?1 AND source_key=?2 AND source_locator_ref=?3
        LIMIT 1`
    )
    .bind(tenantId, SOURCE_KEY, sourceLocatorRef)
    .first();
}

async function existingInitialImport(db, tenantId) {
  return db
    .prepare(
      `SELECT status, phase, created_at
         FROM tenant_import_jobs
        WHERE tenant_id=?1 AND source_key=?2 AND mode='initial'
        ORDER BY created_at ASC
        LIMIT 1`
    )
    .bind(tenantId, SOURCE_KEY)
    .first();
}

function compatibilityDecision(importJob) {
  if (!importJob) return null;
  return {
    sourceKey: SOURCE_KEY,
    decisionKind: DECISION_KIND,
    status: 'confirmed',
    authority: 'preexisting_import',
    confirmedAt: importJob.created_at || null
  };
}

async function readDecisionState(db, tenantId) {
  const connection = await activeConnection(db, tenantId);
  if (!connection) {
    return { sourceConnected: false, decision: null };
  }
  if (connection.provider !== 'yupoo' || connection.source_key !== SOURCE_KEY) {
    throw decisionError('import_decision_source_invalid', 502);
  }

  const [decision, importJob] = await Promise.all([
    storedDecision(db, tenantId, connection.source_locator_ref),
    existingInitialImport(db, tenantId)
  ]);
  return {
    sourceConnected: true,
    decision: decision ? publicDecision(decision) : compatibilityDecision(importJob)
  };
}

async function confirmDecision(db, tenantId, principalId, body) {
  if (body?.sourceKey !== SOURCE_KEY || body?.decisionKind !== DECISION_KIND) {
    throw decisionError('import_decision_invalid', 400);
  }

  const connection = await activeConnection(db, tenantId);
  if (!connection) throw decisionError('import_decision_source_required', 409);
  if (connection.provider !== 'yupoo' || connection.source_key !== SOURCE_KEY) {
    throw decisionError('import_decision_source_invalid', 502);
  }

  const current = await storedDecision(db, tenantId, connection.source_locator_ref);
  if (current) return publicDecision(current);

  // PB6 arrived after the first beta source was already connected. If a real
  // initial-import job exists, preserve that historical authority and never claim
  // the merchant's later tap started work that had already begun.
  const importJob = await existingInitialImport(db, tenantId);
  const authority = importJob ? 'preexisting_import' : 'merchant';
  const actor = authority === 'merchant' ? principalId : null;
  const confirmedAt = importJob?.created_at || null;

  await db.batch([
    db
      .prepare(
        `INSERT INTO tenant_import_decisions
          (tenant_id, source_key, source_locator_ref, decision_kind, status, authority,
           decided_by_principal_id, confirmed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'confirmed', ?5, ?6,
                 COALESCE(?7, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, source_key) DO UPDATE SET
           source_locator_ref=excluded.source_locator_ref,
           decision_kind=excluded.decision_kind,
           status='confirmed',
           authority=excluded.authority,
           decided_by_principal_id=excluded.decided_by_principal_id,
           confirmed_at=excluded.confirmed_at,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(
        tenantId,
        SOURCE_KEY,
        connection.source_locator_ref,
        DECISION_KIND,
        authority,
        actor,
        confirmedAt
      ),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, ?2, ?3, 'source', ?4, ?5, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND action=?3 AND target_id=?4 AND metadata_json=?5
          )`
      )
      .bind(
        tenantId,
        actor,
        authority === 'merchant'
          ? 'tenant.import_decision.confirmed'
          : 'tenant.import_decision.compatibility_recorded',
        SOURCE_KEY,
        JSON.stringify({ decisionKind: DECISION_KIND, authority })
      )
  ]);

  return publicDecision(
    await storedDecision(db, tenantId, connection.source_locator_ref)
  );
}

function tenantIdFromPath(pathname) {
  const match = String(pathname || '').match(
    /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/import-decision$/
  );
  return match?.[1] || null;
}

export async function handlePortalImportDecisionRequest(
  request,
  env,
  { authenticate = authenticateAdminRequest } = {}
) {
  try {
    if (!env.CATALOG_DB) throw decisionError('control_plane_database_unbound', 503);
    const url = new URL(request.url);
    const tenantId = tenantIdFromPath(url.pathname);
    if (!tenantId) return null;

    const auth = await authenticate(request, env);
    const mutate = request.method === 'PUT';
    if (!['GET', 'PUT'].includes(request.method)) {
      return json({ error: 'method_not_allowed' }, 405);
    }
    await requireMembership(env.CATALOG_DB, tenantId, auth.principalId, { mutate });

    if (request.method === 'GET') {
      return json(await readDecisionState(env.CATALOG_DB, tenantId));
    }

    const body = await readJson(request);
    const decision = await confirmDecision(env.CATALOG_DB, tenantId, auth.principalId, body);
    return json({ sourceConnected: true, decision });
  } catch (error) {
    return publicError(error);
  }
}

export const importDecisionContract = Object.freeze({
  sourceKey: SOURCE_KEY,
  decisionKind: DECISION_KIND
});
