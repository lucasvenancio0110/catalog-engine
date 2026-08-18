import app from './index.js';
import { runDueDomainJobs } from './domain-job-scheduler.js';
import {
  isCatalogPlatformHost,
  resolveStorefrontTenant,
  storefrontRoutingError
} from './tenant-routing.js';

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
      runDueDomainJobs(env)
        .then((summary) => {
          console.log(
            'domain_job_schedule',
            JSON.stringify({
              enabled: summary.enabled,
              reason: summary.reason || null,
              selected: summary.selected || 0,
              processed: summary.processed || 0,
              succeeded: summary.succeeded || 0,
              failed: summary.failed || 0,
              busy: summary.busy || 0
            })
          );
        })
        .catch((error) => {
          console.error('domain_job_schedule_failed', String(error?.message || error).slice(0, 160));
        })
    );
  }
};
