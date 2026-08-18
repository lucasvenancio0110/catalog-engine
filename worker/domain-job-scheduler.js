import {
  cloudflareSaasConfigured,
  processTenantDomainProvider
} from './domain-provider-runner.js';

const DEFAULT_JOB_LIMIT = 8;
const MAX_JOB_LIMIT = 20;
const MAX_AUTOMATIC_ATTEMPTS = 8;

function boundedLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_JOB_LIMIT;
  return Math.min(parsed, MAX_JOB_LIMIT);
}

export async function runDueDomainJobs(
  env,
  { fetchImpl = fetch, limit = DEFAULT_JOB_LIMIT } = {}
) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!cloudflareSaasConfigured(env)) {
    return { enabled: false, reason: 'cloudflare_saas_unconfigured', processed: 0 };
  }

  const db = env.CATALOG_DB;
  const jobLimit = boundedLimit(limit);

  // A Worker can be terminated while a provider request is running. Reclaim only jobs that
  // have been stuck long enough that the previous execution is no longer expected to finish.
  await db
    .prepare(
      `UPDATE tenant_domain_jobs
          SET status='failed',
              next_attempt_at=CURRENT_TIMESTAMP,
              last_error_code='domain_job_stale_reclaimed',
              finished_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running'
          AND updated_at <= datetime(CURRENT_TIMESTAMP,'-15 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id, domain_id, operation, attempt_count
         FROM tenant_domain_jobs
        WHERE status IN ('pending','failed')
          AND attempt_count < ?1
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY CASE operation WHEN 'delete' THEN 0 WHEN 'provision' THEN 1 ELSE 2 END,
                 created_at ASC
        LIMIT ?2`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, jobLimit)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantDomainProvider(
      db,
      {
        tenantId: job.tenant_id,
        domainId: job.domain_id,
        operation: job.operation,
        env
      },
      { fetchImpl }
    );
    outcomes.push({
      jobId: job.job_id,
      operation: job.operation,
      outcome: result.outcome,
      ready: result.ready === true,
      error: result.error || null
    });
  }

  return {
    enabled: true,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((entry) => entry.outcome === 'success').length,
    failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
    busy: outcomes.filter((entry) => entry.outcome === 'busy').length,
    outcomes
  };
}
