import {
  CloudflarePlatformError,
  queryD1Batch,
  uploadTenantCatalogWorker
} from './cloudflare-platform.js';
import { stableOpaqueId } from './runtime-identity.js';
import {
  TENANT_CATALOG_RUNTIME_VERSION
} from './tenant-catalog-runtime.js';
import {
  smokeTenantRuntime,
  tenantDispatchConfigured,
  TenantDispatchError
} from './tenant-dispatch.js';
import { maybeAdvanceTenantToPublish } from './tenant-publish-gate.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 6;

function runtimeConfig(env) {
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || !dispatchNamespace) return null;
  return { accountId, apiToken, dispatchNamespace };
}

async function runtimeJobId(tenantId) {
  return stableOpaqueId('rtjob', `${tenantId}:v${TENANT_CATALOG_RUNTIME_VERSION}`);
}

async function discoverCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN tenant_verification_jobs v ON v.tenant_id=r.tenant_id
           AND v.status='success'
        WHERE r.current_step='domain'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND i.schema_version >= 3
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
          AND (
            p.runtime_kind!='catalog' OR
            p.runtime_status!='verified' OR
            p.runtime_version < ?1
          )
        ORDER BY r.created_at ASC
        LIMIT ?2`
    )
    .bind(TENANT_CATALOG_RUNTIME_VERSION, limit)
    .all();

  for (const row of result.results || []) {
    const jobId = await runtimeJobId(row.tenant_id);
    await db
      .prepare(
        `INSERT INTO tenant_runtime_jobs
          (job_id, tenant_id, target_runtime_version, status, attempt_count,
           next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_runtime_jobs.status='success' THEN 'success'
             WHEN tenant_runtime_jobs.status='running' THEN 'running'
             WHEN tenant_runtime_jobs.status='staged' THEN 'staged'
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_runtime_jobs.status='success' THEN NULL
             ELSE COALESCE(tenant_runtime_jobs.next_attempt_at,CURRENT_TIMESTAMP)
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id, TENANT_CATALOG_RUNTIME_VERSION)
      .run();
  }
  return (result.results || []).length;
}

async function loadContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.dispatch_namespace, p.worker_script_name, p.worker_version,
              p.d1_database_id, p.runtime_kind, p.runtime_status, p.runtime_version,
              i.schema_version,
              s.store_name, s.logo_path, s.whatsapp, s.instagram, s.currency,
              s.theme_key, s.primary_color, s.secondary_color, s.home_sections_json,
              r.provisioning_id
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
         JOIN tenant_store_profiles s ON s.tenant_id=p.tenant_id
         LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
           SELECT r2.provisioning_id
             FROM tenant_provisioning_runs r2
            WHERE r2.tenant_id=p.tenant_id
            ORDER BY r2.created_at DESC LIMIT 1
         )
        WHERE p.tenant_id=?1
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

function publicStoreProfile(context) {
  let homeSections = [];
  try {
    homeSections = JSON.parse(context.home_sections_json || '[]');
  } catch {
    homeSections = [];
  }
  const logoPath = String(context.logo_path || '');
  return {
    name: String(context.store_name || '').slice(0, 120),
    logoPath: /^\/[a-z0-9/_\-.]{1,240}$/i.test(logoPath) ? logoPath : null,
    whatsapp: String(context.whatsapp || '').replace(/[^+\d]/g, '').slice(0, 24) || null,
    instagram: String(context.instagram || '').replace(/^@/, '').replace(/[^a-z0-9._]/gi, '').slice(0, 40) || null,
    currency: String(context.currency || 'BRL').slice(0, 8),
    themeKey: String(context.theme_key || 'premium-dark').slice(0, 80),
    primaryColor: /^#[a-f0-9]{6}$/i.test(String(context.primary_color || '')) ? context.primary_color : null,
    secondaryColor: /^#[a-f0-9]{6}$/i.test(String(context.secondary_color || '')) ? context.secondary_color : null,
    homeSections: Array.isArray(homeSections)
      ? homeSections.map((item) => String(item).slice(0, 80)).slice(0, 20)
      : []
  };
}

async function seedRuntimePublicMeta(platform, context, tenantId, fetchImpl) {
  const store = publicStoreProfile(context);
  const verification = await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: [
        { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
        {
          sql: `SELECT COUNT(*) AS total
                  FROM data_plane_identity
                 WHERE tenant_id=?1 AND schema_version>=3`,
          params: [tenantId]
        }
      ]
    },
    { fetchImpl }
  );
  const products = Number(verification[0]?.results?.[0]?.total || 0);
  const identity = Number(verification[1]?.results?.[0]?.total || 0);
  if (products < 1 || identity !== 1) {
    throw new CloudflarePlatformError('tenant_runtime_catalog_not_ready', 409);
  }
  const navigation = [
    { id: 'clubs', label: 'Clubes', kind: 'teams' },
    { id: 'national-teams', label: 'Seleções', kind: 'national_teams' },
    { id: 'new-arrivals', label: 'Novidades', kind: 'facet', facetId: 'new-arrivals' },
    { id: 'retro', label: 'Retrô', kind: 'facet', facetId: 'retro' }
  ];
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: [
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('store', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [JSON.stringify(store)]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('storage', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [JSON.stringify({ mode: 'edge-proxy' })]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('navigation', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [JSON.stringify(navigation)]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('stats', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [JSON.stringify({ products })]
        }
      ]
    },
    { fetchImpl }
  );
  return { products, store };
}

async function claimJob(db, job, { countAttempt }) {
  const result = await db
    .prepare(
      `UPDATE tenant_runtime_jobs
          SET status='running',
              attempt_count=attempt_count+?2,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
              finished_at=NULL, last_error_code=NULL,
              updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1
          AND status IN ('pending','failed','staged')
          AND attempt_count < ?3`
    )
    .bind(job.job_id, countAttempt ? 1 : 0, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  return Number(result.meta?.changes || 0) === 1;
}

async function markStaged(db, job, upload) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET runtime_kind='catalog', runtime_status='staged', runtime_version=?2,
                runtime_verified_at=NULL, runtime_last_error_code=NULL,
                worker_version=COALESCE(?3,worker_version),
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, TENANT_CATALOG_RUNTIME_VERSION, upload.versionId || null),
    db
      .prepare(
        `UPDATE tenant_runtime_jobs
            SET status='staged', staged_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id)
  ]);
}

async function markVerified(db, job, smoke) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET runtime_kind='catalog', runtime_status='verified', runtime_version=?2,
                runtime_verified_at=CURRENT_TIMESTAMP,
                runtime_last_error_code=NULL, last_checked_at=CURRENT_TIMESTAMP,
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, TENANT_CATALOG_RUNTIME_VERSION),
    db
      .prepare(
        `UPDATE tenant_runtime_jobs
            SET status='success', next_attempt_at=NULL,
                finished_at=CURRENT_TIMESTAMP, last_error_code=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?1, NULL, 'tenant.runtime.verified', 'tenant_runtime', ?1, ?2, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM tenant_audit_log
             WHERE tenant_id=?1 AND action='tenant.runtime.verified' AND metadata_json=?2
          )`
      )
      .bind(
        job.tenant_id,
        JSON.stringify({ runtimeVersion: TENANT_CATALOG_RUNTIME_VERSION, products: smoke.products })
      )
  ]);
  await maybeAdvanceTenantToPublish(db, job.tenant_id);
}

async function failJob(db, job, safeCode) {
  await db.batch([
    db
      .prepare(
        `UPDATE tenant_runtime_jobs
            SET status='failed', finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, safeCode),
    db
      .prepare(
        `UPDATE tenant_data_plane_provider_state
            SET runtime_status='error', runtime_last_error_code=?2,
                last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(job.tenant_id, safeCode)
  ]);
}

function safeError(error) {
  if (error instanceof CloudflarePlatformError || error instanceof TenantDispatchError) return error.code;
  return 'tenant_runtime_activation_failed';
}

export async function processTenantRuntime(
  db,
  { job, env },
  { fetchImpl = fetch } = {}
) {
  const platform = runtimeConfig(env);
  if (!platform) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const context = await loadContext(db, job.tenant_id);
  if (!context?.d1_database_id || !context.worker_script_name) {
    return { outcome: 'blocked', reason: 'tenant_data_plane_not_ready' };
  }
  if (context.dispatch_namespace !== platform.dispatchNamespace) {
    return { outcome: 'failed', error: 'tenant_dispatch_namespace_mismatch' };
  }
  if (Number(context.schema_version || 0) < 3) {
    return { outcome: 'blocked', reason: 'tenant_schema_not_ready' };
  }

  const needsUpload = !(
    context.runtime_kind === 'catalog' &&
    ['staged','verified'].includes(context.runtime_status) &&
    Number(context.runtime_version || 0) === TENANT_CATALOG_RUNTIME_VERSION
  );
  if (!(await claimJob(db, job, { countAttempt: needsUpload }))) {
    return { outcome: 'busy', jobId: job.job_id };
  }

  try {
    if (needsUpload) {
      const seeded = await seedRuntimePublicMeta(platform, context, job.tenant_id, fetchImpl);
      const upload = await uploadTenantCatalogWorker(
        {
          ...platform,
          scriptName: context.worker_script_name,
          databaseId: context.d1_database_id,
          tenantId: job.tenant_id
        },
        { fetchImpl }
      );
      await markStaged(db, job, upload);
      if (!tenantDispatchConfigured(env)) {
        return { outcome: 'staged', jobId: job.job_id, products: seeded.products, reason: 'tenant_dispatch_unbound' };
      }
    } else if (!tenantDispatchConfigured(env)) {
      await db
        .prepare(
          `UPDATE tenant_runtime_jobs
              SET status='staged', next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                  updated_at=CURRENT_TIMESTAMP
            WHERE job_id=?1`
        )
        .bind(job.job_id)
        .run();
      return { outcome: 'staged', jobId: job.job_id, reason: 'tenant_dispatch_unbound' };
    }

    const smoke = await smokeTenantRuntime(
      env,
      context.worker_script_name,
      TENANT_CATALOG_RUNTIME_VERSION
    );
    await markVerified(db, job, smoke);
    return { outcome: 'success', jobId: job.job_id, ...smoke };
  } catch (error) {
    const code = safeError(error);
    await failJob(db, job, code);
    return { outcome: 'failed', jobId: job.job_id, error: code };
  }
}

export async function runDueTenantRuntimes(env, { fetchImpl = fetch, limit = 1 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!runtimeConfig(env)) {
    return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 2);
  const discovered = await discoverCandidates(db, bounded);

  await db
    .prepare(
      `UPDATE tenant_runtime_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='tenant_runtime_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id, target_runtime_version, status
         FROM tenant_runtime_jobs
        WHERE status IN ('pending','failed','staged')
          AND attempt_count < ?1
          AND target_runtime_version=?2
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?3`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, TENANT_CATALOG_RUNTIME_VERSION, bounded)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantRuntime(db, { job, env }, { fetchImpl });
    outcomes.push({ tenantId: job.tenant_id, jobId: job.job_id, ...result });
  }
  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    staged: outcomes.filter((item) => item.outcome === 'staged').length,
    succeeded: outcomes.filter((item) => item.outcome === 'success').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    outcomes
  };
}
