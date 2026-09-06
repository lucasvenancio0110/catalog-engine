import { touchAccountPrincipal } from './account-entitlements.js';
import { authenticateAdminRequest } from './admin-auth.js';
import {
  clearPrivatePreviewCookie,
  createPrivatePreviewSession,
  dispatchPrivatePreviewRequest,
  loadPrivatePreviewAuthority,
  loadPrivatePreviewSessionAuthority,
  privatePreviewHeaders,
  PrivatePreviewError,
  revokePrivatePreviewSessions
} from './private-preview.js';
import { isCatalogAdminHost } from './tenant-routing.js';

const PREVIEW_STATUS = /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/preview-status$/;
const PREVIEW_SESSION = /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/preview-session$/;
const PREVIEW_REVOKE = '/api/admin/preview-session';

function json(payload, status = 200, extraHeaders = undefined) {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers });
}

function safeAdminFailure(error) {
  if (error?.status && error?.code) return json({ error: error.code }, error.status);
  console.error('private_preview_admin_failed', String(error?.message || error).slice(0, 120));
  return json({ error: 'preview_temporarily_unavailable' }, 503);
}

function safePreviewFailure(error, pathname) {
  const status = error instanceof PrivatePreviewError ? error.status : 503;
  if (!(error instanceof PrivatePreviewError)) {
    console.error('private_preview_surface_failed', String(error?.message || error).slice(0, 120));
  }
  const headers = privatePreviewHeaders();
  if (pathname === '/preview') {
    headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(status === 404 ? 'Not found' : 'Preview unavailable', { status, headers });
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify({ error: status === 404 ? 'not_found' : 'preview_unavailable' }), {
    status,
    headers
  });
}

function previewShellRequest(request) {
  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  return new Request(url.toString(), {
    method: request.method,
    headers: { accept: 'text/html' }
  });
}

async function authenticatedPrincipal(request, env) {
  if (!env.CATALOG_DB) throw new PrivatePreviewError('control_plane_database_unbound', 503);
  const auth = await authenticateAdminRequest(request, env);
  await touchAccountPrincipal(env.CATALOG_DB, auth.principalId);
  return auth.principalId;
}

export async function handlePrivatePreviewAdminRequest(request, env) {
  const url = new URL(request.url);
  const statusMatch = url.pathname.match(PREVIEW_STATUS);
  const sessionMatch = url.pathname.match(PREVIEW_SESSION);
  const revoke = url.pathname === PREVIEW_REVOKE;
  if (!statusMatch && !sessionMatch && !revoke) return null;

  try {
    const principalId = await authenticatedPrincipal(request, env);

    if (statusMatch && request.method === 'GET') {
      try {
        await loadPrivatePreviewAuthority(env.CATALOG_DB, statusMatch[1], principalId);
        return json({ available: true });
      } catch (error) {
        if (
          error instanceof PrivatePreviewError &&
          ['preview_runtime_not_ready', 'preview_catalog_not_ready', 'preview_store_unavailable'].includes(
            error.code
          )
        ) {
          return json({ available: false });
        }
        throw error;
      }
    }

    if (sessionMatch && request.method === 'POST') {
      const session = await createPrivatePreviewSession(
        env.CATALOG_DB,
        sessionMatch[1],
        principalId
      );
      return json(
        { previewUrl: '/preview', expiresAt: session.expiresAt },
        201,
        { 'set-cookie': session.cookie }
      );
    }

    if (revoke && request.method === 'DELETE') {
      await revokePrivatePreviewSessions(env.CATALOG_DB, principalId);
      return json({}, 204, { 'set-cookie': clearPrivatePreviewCookie() });
    }

    return json({ error: 'method_not_allowed' }, 405, { allow: statusMatch ? 'GET' : revoke ? 'DELETE' : 'POST' });
  } catch (error) {
    if (
      error instanceof PrivatePreviewError &&
      error.code !== 'preview_store_not_found' &&
      error.status === 409
    ) {
      return json({ error: 'preview_not_ready' }, 409);
    }
    return safeAdminFailure(error);
  }
}

export async function handlePrivatePreviewSurfaceRequest(request, env) {
  if (!isCatalogAdminHost(request, env)) return null;
  const url = new URL(request.url);
  const isShell = url.pathname === '/preview';
  const isResource = url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/');
  if (!isShell && !isResource) return null;

  try {
    if (!env.CATALOG_DB) throw new PrivatePreviewError('control_plane_database_unbound', 503);
    const authority = await loadPrivatePreviewSessionAuthority(env.CATALOG_DB, request);

    if (isShell) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new PrivatePreviewError('preview_method_not_allowed', 405);
      }
      if (!env.ASSETS?.fetch) throw new PrivatePreviewError('preview_assets_unavailable', 503);
      const asset = await env.ASSETS.fetch(previewShellRequest(request));
      if (!asset.ok) throw new PrivatePreviewError('preview_assets_unavailable', 503);
      const headers = privatePreviewHeaders(asset.headers);
      headers.set(
        'content-security-policy',
        "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
      );
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        status: asset.status,
        statusText: asset.statusText,
        headers
      });
    }

    return dispatchPrivatePreviewRequest(request, env, authority, url.pathname);
  } catch (error) {
    return safePreviewFailure(error, url.pathname);
  }
}
