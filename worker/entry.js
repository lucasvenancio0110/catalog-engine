import app from './index.js';
import { readStoreEntitlements, touchAccountPrincipal } from './account-entitlements.js';
import { authenticateAdminRequest } from './admin-auth.js';
import { runDueDataPlaneMigrations } from './data-plane-migration-runner.js';
import { runDueDataPlaneJobs } from './data-plane-provider-runner.js';
import { dispatchTenantRequest } from './tenant-dispatch.js';
import { runDueDomainJobs } from './domain-job-scheduler.js';
import { handlePortalAuthConfig } from './portal-auth-config.js';
import { handlePortalBrandingRequest, servePublicBrandAsset } from './portal-branding.js';
import { handlePortalImportDecisionRequest } from './portal-import-decision.js';
import { handlePortalStoreCreation } from './portal-store-creation.js';
import {
  handlePrivatePreviewAdminRequest,
  handlePrivatePreviewSurfaceRequest
} from './private-preview-routing.js';
import { runDueTenantClassifications } from './tenant-classification-runner.js';
import { runDueTenantIncrementalClassifications } from './ingestion/incremental-classification-runner.js';
import { runDueTenantIncrementalVerifications } from './ingestion/incremental-verification-runner.js';
import { runDueTenantIncrementalFinalizations } from './ingestion/incremental-finalization-runner.js';
import { runDueTenantIncrementalRecoveries } from './ingestion/incremental-recovery-runner.js';
import { runDueTenantImportDispatches } from './tenant-import-dispatcher.js';
import { runDueTenantRuntimes } from './tenant-runtime-runner.js';
import { runDueTenantSyncScheduling } from './tenant-sync-scheduler.js';
import { runDueTenantSyncReplays } from './tenant-sync-replay.js';
import { runDueTenantVerifications } from './tenant-verification-runner.js';
import {
  isCatalogAdminHost,
  isCatalogPlatformHost,
  resolveStorefrontTenant,
  storefrontRoutingError
} from './tenant-routing.js';

function safeScheduleSummary(summary) {
  return {
    enabled: summary.enabled,
    reason: summary.reason || null,
    limit: summary.limit || 0,
    discovered: summary.discovered || 0,
    selected: summary.selected || 0,
    processed: summary.processed || 0,
    staged: summary.staged || 0,
    dispatched: summary.dispatched || 0,
    scheduled: summary.scheduled || 0,
    succeeded: summary.succeeded || 0,
    failed: summary.failed || 0,
    busy: summary.busy || 0,
    recovered: summary.recovered || 0,
    blocked: summary.blocked || 0,
    reclaimed: summary.reclaimed || 0,
    decisionCounts:
      summary.decisionCounts && typeof summary.decisionCounts === 'object'
        ? Object.fromEntries(
            Object.entries(summary.decisionCounts)
              .filter(([code, total]) => /^tenant_sync_[a-z_]+$/.test(code) && Number(total) >= 0)
              .map(([code, total]) => [code, Number(total)])
          )
        : {}
  };
}

function safeScheduleError(error) {
  const code = String(error?.code || error?.message || error || '').trim().toLowerCase();
  return /^(tenant|sync|supplier|catalog_provider|cloudflare_platform)_[a-z0-9_]{1,112}$/.test(
    code
  )
    ? code
    : 'scheduled_operation_failed';
}

function shouldDispatchTenantRequest(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/media/');
}

function looksLikeAssetPath(pathname) {
  const last = pathname.split('/').pop() || '';
  return /\.[a-z0-9]{1,12}$/i.test(last);
}

function adminShellRequest(request) {
  const url = new URL(request.url);
  // Cloudflare Static Assets defaults to auto-trailing-slash HTML handling.
  // Requesting /app.html therefore produces a 307 canonical redirect to /app.
  // Fetch the canonical extensionless path internally so the customer portal
  // shell is returned as a 200 without creating a redirect loop at the admin host.
  url.pathname = '/app';
  url.search = '';
  return new Request(url.toString(), request);
}

function portalAdminJson(payload, status = 200) {
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

function portalAccountError(error) {
  if (error?.status && error?.code) return portalAdminJson({ error: error.code }, error.status);
  console.error('portal_account_boundary_failed', String(error?.message || error).slice(0, 120));
  return portalAdminJson({ error: 'admin_temporarily_unavailable' }, 503);
}

async function handlePortalAccountBoundary(request, env, ctx) {
  try {
    if (!env.CATALOG_DB) {
      return portalAdminJson({ error: 'control_plane_database_unbound' }, 503);
    }
    const auth = await authenticateAdminRequest(request, env);
    await touchAccountPrincipal(env.CATALOG_DB, auth.principalId);
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/session' && request.method === 'GET') {
      const [response, entitlements] = await Promise.all([
        app.fetch(request, env, ctx),
        readStoreEntitlements(env.CATALOG_DB, auth.principalId)
      ]);
      if (!response.ok) return response;
      const payload = await response.json();
      return portalAdminJson({ ...payload, entitlements }, response.status);
    }

    if (url.pathname === '/api/admin/stores' && request.method === 'POST') {
      return handlePortalStoreCreation({
        request,
        env,
        ctx,
        principalId: auth.principalId,
        delegate: (nextRequest, nextEnv, nextCtx) => app.fetch(nextRequest, nextEnv, nextCtx)
      });
    }

    return app.fetch(request, env, ctx);
  } catch (error) {
    return portalAccountError(error);
  }
}

async function serveAdminSurface(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return storefrontRoutingError({ reason: 'not_found', status: 404 });
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    return storefrontRoutingError({ reason: 'not_found', status: 404 });
  }
  if (looksLikeAssetPath(url.pathname) && url.pathname !== '/app.html') {
    return app.fetch(request, env, ctx);
  }
  return env.ASSETS.fetch(adminShellRequest(request));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Brand assets use Catalog Engine-owned opaque paths. The Cloudflare Images
    // provider identifier remains private and is resolved server-side from D1.
    if (url.pathname.startsWith('/brand-assets/')) {
      const response = await servePublicBrandAsset(request, env);
      if (response) return response;
    }

    // Health remains available for infrastructure probes. Admin APIs only exist on
    // Catalog Engine platform/admin hosts, never on a merchant storefront domain.
    if (url.pathname === '/api/health') return app.fetch(request, env, ctx);
    if (url.pathname === '/api/auth/config') {
      if (!isCatalogAdminHost(request, env)) {
        return storefrontRoutingError({ reason: 'not_found', status: 404 });
      }
      return handlePortalAuthConfig(request, env);
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isCatalogPlatformHost(request, env)) {
        return storefrontRoutingError({ reason: 'not_found', status: 404 });
      }
      const previewAdminResponse = await handlePrivatePreviewAdminRequest(request, env);
      if (previewAdminResponse) return previewAdminResponse;
      if (/^\/api\/admin\/stores\/t_[a-f0-9]{20}\/branding(?:\/logo)?$/.test(url.pathname)) {
        return handlePortalBrandingRequest(request, env);
      }
      if (/^\/api\/admin\/stores\/t_[a-f0-9]{20}\/import-decision$/.test(url.pathname)) {
        const response = await handlePortalImportDecisionRequest(request, env);
        if (response) return response;
      }
      if (
        (url.pathname === '/api/admin/session' && request.method === 'GET') ||
        (url.pathname === '/api/admin/stores' && request.method === 'POST')
      ) {
        return handlePortalAccountBoundary(request, env, ctx);
      }
      return app.fetch(request, env, ctx);
    }

    // The authenticated preview lives only on the admin host. A short-lived host-only
    // HttpOnly capability resolves membership + verified runtime server-side on every
    // catalog/media request, while the browser receives the same storefront shell.
    const privatePreviewResponse = await handlePrivatePreviewSurfaceRequest(request, env);
    if (privatePreviewResponse) return privatePreviewResponse;

    // app.catalogoengine.com is a first-party product surface, not a storefront
    // preview of tenant #0001. Its navigation always resolves to the portal entry.
    if (isCatalogAdminHost(request, env)) return serveAdminSurface(request, env, ctx);

    // Do not expose the portal HTML entry from merchant custom domains.
    if (url.pathname === '/app.html') {
      return storefrontRoutingError({ reason: 'not_found', status: 404 });
    }

    const tenant = await resolveStorefrontTenant(request, env);
    if (!tenant.allowed) return storefrontRoutingError(tenant);

    // HTML/CSS/JS stay on the shared platform Worker. Only catalog API/media traffic
    // for a verified non-default tenant enters its isolated Workers for Platforms script.
    if (tenant.mode === 'dispatch' && shouldDispatchTenantRequest(url.pathname)) {
      try {
        return await dispatchTenantRequest(request, env, tenant.dispatchScriptName);
      } catch (error) {
        console.error(
          'tenant_dispatch_failed',
          String(error?.code || 'tenant_dispatch_unavailable').slice(0, 80)
        );
        return storefrontRoutingError({ reason: 'tenant_dispatch_unavailable', status: 503 });
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        runDueDataPlaneJobs(env),
        runDueDataPlaneMigrations(env),
        runDueTenantImportDispatches(env),
        runDueTenantSyncScheduling(env),
        runDueTenantSyncReplays(env),
        runDueTenantIncrementalRecoveries(env),
        runDueTenantIncrementalClassifications(env),
        runDueTenantIncrementalVerifications(env),
        runDueTenantIncrementalFinalizations(env),
        runDueTenantClassifications(env),
        runDueTenantVerifications(env),
        runDueDomainJobs(env)
      ]).then(async (results) => {
        const labels = [
          'data_plane_job_schedule',
          'data_plane_migration_schedule',
          'tenant_import_dispatch_schedule',
          'tenant_sync_schedule',
          'tenant_sync_replay_schedule',
          'tenant_sync_recovery_schedule',
          'tenant_incremental_classification_schedule',
          'tenant_incremental_verification_schedule',
          'tenant_incremental_finalization_schedule',
          'tenant_classification_schedule',
          'tenant_verification_schedule',
          'domain_job_schedule'
        ];
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          const label = labels[index];
          if (result.status === 'fulfilled') {
            console.log(label, JSON.stringify(safeScheduleSummary(result.value)));
          } else {
            console.error(`${label}_failed`, safeScheduleError(result.reason));
          }
        }

        try {
          const runtimeSummary = await runDueTenantRuntimes(env);
          console.log('tenant_runtime_schedule', JSON.stringify(safeScheduleSummary(runtimeSummary)));
        } catch (error) {
          console.error('tenant_runtime_schedule_failed', safeScheduleError(error));
        }
      })
    );
  }
};