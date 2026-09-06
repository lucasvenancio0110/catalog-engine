import { CATALOG_CLASSIFIER_VERSION } from '../src/domain/catalog-classifier.js';
import { dispatchTenantRequest, TenantDispatchError } from './tenant-dispatch.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from './tenant-catalog-runtime.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const PREVIEW_PATH_PATTERN = /^\/(?:api\/(?:catalog\/meta|products(?:\/p_[a-f0-9]{20})?|leagues|teams(?:\/[^/?#]+)?|facets)|media\/m_[a-f0-9]{20}(?:\/(?:original|view|thumb))?)$/;

export class PrivatePreviewError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'PrivatePreviewError';
    this.code = code;
    this.status = status;
  }
}

export function validatePrivatePreviewContext(context) {
  if (!context?.membership_role || context.membership_status !== 'active') {
    return 'preview_store_not_found';
  }
  if (context.setup_status === 'suspended') return 'preview_store_unavailable';
  if (
    context.worker_status !== 'active' ||
    context.runtime_kind !== 'catalog' ||
    context.runtime_status !== 'verified' ||
    Number(context.runtime_version || 0) < TENANT_CATALOG_RUNTIME_VERSION ||
    !context.worker_script_name
  ) {
    return 'preview_runtime_not_ready';
  }
  if (
    context.verification_status !== 'success' ||
    Number(context.classifier_version || 0) !== CATALOG_CLASSIFIER_VERSION ||
    Number(context.finding_count || 0) !== 0
  ) {
    return 'preview_catalog_not_ready';
  }
  return null;
}

export async function loadPrivatePreviewAuthority(db, tenantId, principalId) {
  if (!TENANT_ID_PATTERN.test(String(tenantId || ''))) {
    throw new PrivatePreviewError('preview_store_not_found', 404);
  }
  const context = await db
    .prepare(
      `SELECT m.role AS membership_role, m.status AS membership_status,
              s.setup_status,
              p.worker_script_name, p.worker_status,
              p.runtime_kind, p.runtime_status, p.runtime_version,
              v.status AS verification_status, v.classifier_version, v.finding_count
         FROM tenant_memberships m
         JOIN tenant_store_profiles s ON s.tenant_id=m.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=m.tenant_id
         LEFT JOIN tenant_verification_jobs v ON v.job_id=(
           SELECT v2.job_id
             FROM tenant_verification_jobs v2
            WHERE v2.tenant_id=m.tenant_id
            ORDER BY v2.created_at DESC
            LIMIT 1
         )
        WHERE m.tenant_id=?1
          AND m.principal_id=?2
          AND m.status='active'
        LIMIT 1`
    )
    .bind(tenantId, principalId)
    .first();

  const failure = validatePrivatePreviewContext(context);
  if (failure) {
    const status = failure === 'preview_store_not_found' ? 404 : 409;
    throw new PrivatePreviewError(failure, status);
  }

  return Object.freeze({
    tenantId,
    workerScriptName: context.worker_script_name
  });
}

export function normalizePrivatePreviewPath(pathname) {
  const path = String(pathname || '');
  if (!PREVIEW_PATH_PATTERN.test(path)) {
    throw new PrivatePreviewError('preview_resource_not_found', 404);
  }
  return path;
}

export async function dispatchPrivatePreviewRequest(request, env, authority, pathname) {
  const path = normalizePrivatePreviewPath(pathname);
  if (!authority?.workerScriptName || !authority?.tenantId) {
    throw new PrivatePreviewError('preview_authority_missing', 500);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new PrivatePreviewError('preview_method_not_allowed', 405);
  }

  const sourceUrl = new URL(request.url);
  const target = new URL(`https://tenant-preview.internal${path}`);
  target.search = sourceUrl.search;

  const internalRequest = new Request(target, {
    method: request.method,
    headers: {
      accept: request.headers.get('accept') || '*/*'
    }
  });

  let response;
  try {
    response = await dispatchTenantRequest(internalRequest, env, authority.workerScriptName);
  } catch (error) {
    if (error instanceof TenantDispatchError) {
      throw new PrivatePreviewError('preview_temporarily_unavailable', 503);
    }
    throw error;
  }

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.delete('server');
  headers.delete('cf-ray');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
