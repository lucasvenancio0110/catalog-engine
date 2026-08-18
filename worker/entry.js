import app from './index.js';
import { runDueDataPlaneMigrations } from './data-plane-migration-runner.js';
import { runDueDataPlaneJobs } from './data-plane-provider-runner.js';
import { runDueDomainJobs } from './domain-job-scheduler.js';
import { runDueTenantClassifications } from './tenant-classification-runner.js';
import { runDueTenantImportDispatches } from './tenant-import-dispatcher.js';
import { runDueTenantVerifications } from './tenant-verification-runner.js';
import {
  isCatalogPlatformHost,
  resolveStorefrontTenant,
  storefrontRoutingError
} from './tenant-routing.js';

function safeScheduleSummary(summary) {
  return {
    enabled: summary.enabled,
    reason: summary.reason || null,
    discovered: summary.discovered || 0,
    selected: summary.selected || 0,
    processed: summary.processed || 0,
    dispatched: summary.dispatched || 0,
    succeeded: summary.succeeded || 0,
    failed: summary.failed || 0,
    busy: summary.busy || 0
  };
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

    const tenant = await resolveStorefrontTenant(request, env);
    if (!tenant.allowed) return storefrontRoutingError(tenant);

    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        runDueDataPlaneJobs(env),
        runDueDataPlaneMigrations(env),
        runDueTenantImportDispatches(env),
        runDueTenantClassifications(env),
        runDueTenantVerifications(env),
        runDueDomainJobs(env)
      ]).then((results) => {
        const labels = [
          'data_plane_job_schedule',
          'data_plane_migration_schedule',
          'tenant_import_dispatch_schedule',
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
