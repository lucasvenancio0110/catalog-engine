import app from './index.js';
import { runDueDomainJobs } from './domain-job-scheduler.js';

export default {
  fetch: app.fetch,

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
