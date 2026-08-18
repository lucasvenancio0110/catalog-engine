import base from './entry.js';
import { runDueTenantPublishes } from './tenant-publish-runner.js';

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
  fetch: base.fetch,

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
