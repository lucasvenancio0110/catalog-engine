import app from './index.js';
import { runDueDataPlaneMigrations } from './data-plane-migration-runner.js';
import { runDueDataPlaneJobs } from './data-plane-provider-runner.js';
import { dispatchTenantRequest } from './tenant-dispatch.js';
import { runDueDomainJobs } from './domain-job-scheduler.js';
import { runDueTenantClassifications } from './tenant-classification-runner.js';
import { runDueTenantImportDispatches } from './tenant-import-dispatcher.js';
import { runDueTenantSyncScheduling } from './tenant-sync-scheduler.js';
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
    dispatched: summary.dispatched || 0,
    scheduled: summary.scheduled || 0,
    succeeded: summary.succeeded || 0,
    failed: summary.failed || 0,
    busy: summary.busy || 0,
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

    // Health remains available for infrastructure probes. Admin APIs only exist on
    // Catalog Engine platform/admin hosts, never on a merchant storefront domain.
    if (url.pathname === '/api/health') return app.fetch(request, env, ctx);
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isCatalogPlatformHost(request, env)) {
        return storefrontRoutingError({ reason: 'not_found', status: 404 });
      }
      return app.fetch(request, env, ctx);
    }

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
        runDueTenantClassifications(env),
        runDueTenantVerifications(env),
        runDueDomainJobs(env)
      ]).then((results) => {
        const labels = [
          'data_plane_job_schedule',
          'data_plane_migration_schedule',
          'tenant_import_dispatch_schedule',
          'tenant_sync_schedule',
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
            console.error(`${label}_failed`, String(result.reason?.message || result.reason).slice(0, 160));
          }
        }
      })
    );
  }
};
