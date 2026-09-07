import base from './entry.js';
import { TenantConstructionState } from './instant-catalog-construction.js';
import { handlePortalConstructionPreviewRequest } from './portal-construction-preview.js';
import { runDueTenantPublishes } from './tenant-publish-runner.js';
import { isCatalogPlatformHost, storefrontRoutingError } from './tenant-routing.js';

const CONSTRUCTION_ROUTE = /^\/api\/admin\/stores\/t_[a-f0-9]{20}\/construction-preview$/;

export { TenantConstructionState };

function safePublishSummary(summary) {
  return {
    enabled: summary.enabled,
    reason: summary.reason || null,
    discovered: summary.discovered || 0,
    selected: summary.selected || 0,
    processed: summary.processed || 0,
    succeeded: summary.succeeded || 0,
    failed: summary.failed || 0,
    blocked: summary.blocked || 0
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (CONSTRUCTION_ROUTE.test(url.pathname)) {
      if (!isCatalogPlatformHost(request, env)) {
        return storefrontRoutingError({ reason: 'not_found', status: 404 });
      }
      const response = await handlePortalConstructionPreviewRequest(request, env);
      if (response) return response;
    }
    return base.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    base.scheduled(controller, env, ctx);
    ctx.waitUntil(
      runDueTenantPublishes(env)
        .then((summary) => {
          console.log('tenant_publish_schedule', JSON.stringify(safePublishSummary(summary)));
        })
        .catch((error) => {
          console.error(
            'tenant_publish_schedule_failed',
            String(error?.message || error).slice(0, 160)
          );
        })
    );
  }
};
