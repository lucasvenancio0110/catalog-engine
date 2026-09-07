import base from './entry-publish.js';
import { TenantConstructionState } from './instant-catalog-construction.js';
import { handlePortalConstructionPreviewRequest } from './portal-construction-preview.js';
import { isCatalogPlatformHost, storefrontRoutingError } from './tenant-routing.js';

const CONSTRUCTION_ROUTE = /^\/api\/admin\/stores\/t_[a-f0-9]{20}\/construction-preview$/;

export { TenantConstructionState };

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
    return base.scheduled(controller, env, ctx);
  }
};
