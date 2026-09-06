import { CATALOG_CLASSIFIER_VERSION } from '../src/domain/catalog-classifier.js';
import { sha256Hex } from './runtime-identity.js';
import { dispatchTenantRequest, TenantDispatchError } from './tenant-dispatch.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from './tenant-catalog-runtime.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const PREVIEW_PATH_PATTERN = /^\/(?:api\/(?:catalog\/meta|categories|products(?:\/p_[a-f0-9]{20})?|leagues|teams(?:\/[^/?#]+)?|facets)|media\/m_[a-f0-9]{20}(?:\/(?:original|view|thumb))?)$/;
const PREVIEW_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const PREVIEW_COOKIE_NAME = '__Host-ce-preview';
export const PRIVATE_PREVIEW_TTL_SECONDS = 30 * 60;

export class PrivatePreviewError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'PrivatePreviewError';
    this.code = code;
    this.status = status;
  }
}

function randomPreviewToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isoNow(nowMs = Date.now()) {
  const value = Number(nowMs);
  if (!Number.isFinite(value)) throw new PrivatePreviewError('preview_clock_invalid', 500);
  return new Date(value).toISOString();
}

export function privatePreviewCookie(token, maxAge = PRIVATE_PREVIEW_TTL_SECONDS) {
  if (!PREVIEW_TOKEN_PATTERN.test(String(token || ''))) {
    throw new PrivatePreviewError('preview_session_invalid', 500);
  }
  return `${PREVIEW_COOKIE_NAME}=${token}; Path=/; Max-Age=${Math.max(0, Number(maxAge) || 0)}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearPrivatePreviewCookie() {
  return `${PREVIEW_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function readPrivatePreviewToken(request) {
  const header = String(request?.headers?.get('cookie') || '');
  if (!header || header.length > 8192) return null;
  for (const rawPart of header.split(';')) {
    const part = rawPart.trim();
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    if (part.slice(0, separator) !== PREVIEW_COOKIE_NAME) continue;
    const token = part.slice(separator + 1);
    return PREVIEW_TOKEN_PATTERN.test(token) ? token : null;
  }
  return null;
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
            ORDER BY v2.created_at DESC, v2.job_id DESC
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

export async function createPrivatePreviewSession(db, tenantId, principalId, nowMs = Date.now()) {
  const authority = await loadPrivatePreviewAuthority(db, tenantId, principalId);
  const token = randomPreviewToken();
  const sessionHash = await sha256Hex(token);
  const createdAt = isoNow(nowMs);
  const expiresAt = isoNow(Number(nowMs) + PRIVATE_PREVIEW_TTL_SECONDS * 1000);

  await db
    .prepare('DELETE FROM tenant_private_preview_sessions WHERE datetime(expires_at) <= datetime(?1)')
    .bind(createdAt)
    .run();
  await db
    .prepare(
      `INSERT INTO tenant_private_preview_sessions
         (session_hash, tenant_id, principal_id, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(sessionHash, tenantId, principalId, createdAt, expiresAt)
    .run();

  return Object.freeze({
    authority,
    token,
    expiresAt,
    cookie: privatePreviewCookie(token)
  });
}

export async function loadPrivatePreviewSessionAuthority(db, request, nowMs = Date.now()) {
  const token = readPrivatePreviewToken(request);
  if (!token) throw new PrivatePreviewError('preview_session_required', 404);
  const sessionHash = await sha256Hex(token);
  const now = isoNow(nowMs);
  const session = await db
    .prepare(
      `SELECT tenant_id, principal_id
         FROM tenant_private_preview_sessions
        WHERE session_hash=?1
          AND datetime(expires_at) > datetime(?2)
        LIMIT 1`
    )
    .bind(sessionHash, now)
    .first();
  if (!session?.tenant_id || !session?.principal_id) {
    throw new PrivatePreviewError('preview_session_invalid', 404);
  }
  return loadPrivatePreviewAuthority(db, session.tenant_id, session.principal_id);
}

export async function revokePrivatePreviewSessions(db, principalId) {
  await db
    .prepare('DELETE FROM tenant_private_preview_sessions WHERE principal_id=?1')
    .bind(principalId)
    .run();
}

export function normalizePrivatePreviewPath(pathname) {
  const path = String(pathname || '');
  if (!PREVIEW_PATH_PATTERN.test(path)) {
    throw new PrivatePreviewError('preview_resource_not_found', 404);
  }
  return path;
}

export function privatePreviewHeaders(input = undefined) {
  const headers = new Headers(input);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.delete('server');
  headers.delete('cf-ray');
  return headers;
}

export async function dispatchPrivatePreviewRequest(request, env, authority, pathname) {
  const path = normalizePrivatePreviewPath(pathname);
  if (!authority?.workerScriptName || !TENANT_ID_PATTERN.test(String(authority?.tenantId || ''))) {
    throw new PrivatePreviewError('preview_authority_missing', 500);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new PrivatePreviewError('preview_method_not_allowed', 405);
  }

  const sourceUrl = new URL(request.url);
  const target = new URL(`https://${authority.tenantId}.tenant-preview.internal${path}`);
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

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: privatePreviewHeaders(response.headers)
  });
}
