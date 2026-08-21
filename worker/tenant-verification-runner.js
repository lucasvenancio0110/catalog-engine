import { CEI_INTELLIGENCE_STATE_CONTRACT_VERSION } from '../src/catalog-intelligence/core/intelligence-state.js';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION
} from '../src/domain/catalog-classifier.js';
import { CloudflarePlatformError, queryD1Batch } from './cloudflare-platform.js';
import { stableOpaqueId } from './runtime-identity.js';
import { TENANT_DATA_PLANE_SCHEMA_VERSION } from './tenant-data-plane-schema-v4.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 5;
const MAX_FINDINGS = 32;

function runtimeConfig(env) {
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || !dispatchNamespace) return null;
  return { accountId, apiToken, dispatchNamespace };
}

async function verificationJobId(tenantId) {
  return stableOpaqueId('vrfjob', `${tenantId}:v${CATALOG_CLASSIFIER_VERSION}`);
}

async function discoverCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN tenant_import_jobs imp ON imp.tenant_id=r.tenant_id AND imp.status='success'
         JOIN tenant_classification_jobs cls ON cls.tenant_id=r.tenant_id
           AND cls.status='success'
           AND cls.classifier_version=?1
           AND cls.classifier_key=?2
        WHERE r.current_step='verify'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND i.schema_version >= ?3
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        ORDER BY r.created_at ASC
        LIMIT ?4`
    )
    .bind(
      CATALOG_CLASSIFIER_VERSION,
      CATALOG_CLASSIFIER_KEY,
      TENANT_DATA_PLANE_SCHEMA_VERSION,
      limit
    )
    .all();

  for (const row of result.results || []) {
    const jobId = await verificationJobId(row.tenant_id);
    await db
      .prepare(
        `INSERT INTO tenant_verification_jobs
          (job_id, tenant_id, classifier_version, status, attempt_count,
           next_attempt_at, findings_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'pending', 0, CURRENT_TIMESTAMP, '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_verification_jobs.status IN ('running','success') THEN tenant_verification_jobs.status
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_verification_jobs.status IN ('running','success') THEN tenant_verification_jobs.next_attempt_at
             ELSE CURRENT_TIMESTAMP
           END,
           last_error_code=CASE
             WHEN tenant_verification_jobs.status IN ('running','success') THEN tenant_verification_jobs.last_error_code
             ELSE NULL
           END,
           findings_json=CASE
             WHEN tenant_verification_jobs.status IN ('running','success') THEN tenant_verification_jobs.findings_json
             ELSE '[]'
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id, CATALOG_CLASSIFIER_VERSION)
      .run();
  }
  return (result.results || []).length;
}

async function loadContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.d1_database_id, p.dispatch_namespace,
              r.provisioning_id, i.schema_version,
              imp.deferred_detail_count
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
         JOIN tenant_import_jobs imp ON imp.import_id=(
           SELECT imp2.import_id
             FROM tenant_import_jobs imp2
            WHERE imp2.tenant_id=p.tenant_id AND imp2.status='success'
            ORDER BY imp2.created_at DESC LIMIT 1
         )
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

async function claimJob(db, job, context) {
  const result = await db
    .prepare(
      `UPDATE tenant_verification_jobs
          SET status='running', attempt_count=attempt_count+1,
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
              last_error_code=NULL, findings_json='[]', updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status IN ('pending','failed') AND attempt_count < ?2`
    )
    .bind(job.job_id, MAX_AUTOMATIC_ATTEMPTS)
    .run();
  if (Number(result.meta?.changes || 0) !== 1) return false;
  if (context.provisioning_id) {
    await db.batch([
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='running', attempt_count=attempt_count+1,
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
                  last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='verify'`
        )
        .bind(context.provisioning_id),
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='verify', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2`
        )
        .bind(context.provisioning_id, job.tenant_id)
    ]);
  }
  return true;
}

function verificationQueries() {
  return [
    { sql: 'SELECT COUNT(*) AS total FROM catalog_products', params: [] },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_classification_state s
              JOIN catalog_products p ON p.product_id=s.product_id
             WHERE s.classifier_version=?1 AND s.classifier_key=?2`,
      params: [CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products p
              LEFT JOIN catalog_product_classification_state s ON s.product_id=p.product_id
             WHERE s.product_id IS NULL OR s.classifier_version!=?1 OR s.classifier_key!=?2`,
      params: [CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_classification_state s
              LEFT JOIN catalog_product_classification_overrides o ON o.product_id=s.product_id
             WHERE s.override_applied != CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products
             WHERE lower(COALESCE(display_name,name,'')) LIKE '%x.yupoo.com%'
                OR lower(COALESCE(description,'')) LIKE '%x.yupoo.com%'
                OR lower(COALESCE(description,'')) LIKE '%photo.yupoo.com%'
                OR lower(COALESCE(search_text,'')) LIKE '%x.yupoo.com%'
                OR lower(COALESCE(display_category_name,category_name,'')) LIKE '%x.yupoo.com%'
                OR lower(COALESCE(description,'')) LIKE '%http://%'
                OR lower(COALESCE(description,'')) LIKE '%https://%'`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products p
              LEFT JOIN catalog_categories c ON c.category_id=p.category_id
             WHERE c.category_id IS NULL`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products p
              LEFT JOIN media_sources m ON m.media_id=p.primary_media_id AND m.active=1
             WHERE p.image_count > 0 AND (p.primary_media_id IS NULL OR m.media_id IS NULL)`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products p
             WHERE p.image_count != (
               SELECT COUNT(*) FROM product_media pm WHERE pm.product_id=p.product_id
             )`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM product_media pm
              LEFT JOIN catalog_products p ON p.product_id=pm.product_id
              LEFT JOIN media_sources m ON m.media_id=pm.media_id AND m.active=1
             WHERE p.product_id IS NULL OR m.media_id IS NULL`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_categories pc
              LEFT JOIN catalog_products p ON p.product_id=pc.product_id
              LEFT JOIN catalog_categories c ON c.category_id=pc.category_id
             WHERE p.product_id IS NULL OR c.category_id IS NULL`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_facets pf
              LEFT JOIN catalog_products p ON p.product_id=pf.product_id
              LEFT JOIN catalog_facets f ON f.facet_id=pf.facet_id
             WHERE p.product_id IS NULL OR f.facet_id IS NULL`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_categories c
             WHERE c.product_count != (
               SELECT COUNT(*) FROM catalog_product_categories pc WHERE pc.category_id=c.category_id
             )`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_teams t
             WHERE t.product_count != (
               SELECT COUNT(*) FROM catalog_products p WHERE p.team_id=t.team_id
             )`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_leagues l
             WHERE l.product_count != (
               SELECT COUNT(*) FROM catalog_products p WHERE p.league_id=l.league_id
             )`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_facets f
             WHERE f.product_count != (
               SELECT COUNT(*) FROM catalog_product_facets pf WHERE pf.facet_id=f.facet_id
             )`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_intelligence_state s
              JOIN catalog_products p ON p.product_id=s.product_id
             WHERE s.contract_version=?1
               AND s.classifier_version=?2
               AND s.classifier_key=?3
               AND json_valid(s.state_json)=1`,
      params: [
        CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
        CATALOG_CLASSIFIER_VERSION,
        CATALOG_CLASSIFIER_KEY
      ]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_products p
              LEFT JOIN catalog_product_intelligence_state s ON s.product_id=p.product_id
             WHERE s.product_id IS NULL
                OR s.contract_version!=?1
                OR s.classifier_version!=?2
                OR s.classifier_key!=?3
                OR json_valid(s.state_json)!=1`,
      params: [
        CEI_INTELLIGENCE_STATE_CONTRACT_VERSION,
        CATALOG_CLASSIFIER_VERSION,
        CATALOG_CLASSIFIER_KEY
      ]
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_intelligence_state s
              LEFT JOIN catalog_product_classification_overrides o ON o.product_id=s.product_id
             WHERE s.override_applied != CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_intelligence_state
             WHERE review_required=1`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_intelligence_state
             WHERE research_required=1`,
      params: []
    },
    {
      sql: `SELECT COUNT(*) AS total
              FROM catalog_product_intelligence_state
             WHERE conflict_count>0`,
      params: []
    }
  ];
}

function totalAt(results, index) {
  return Number(results[index]?.results?.[0]?.total || 0);
}

export function verificationFindings(results, { deferredDetailCount = 0 } = {}) {
  const products = totalAt(results, 0);
  const classified = totalAt(results, 1);
  const intelligence = totalAt(results, 15);
  const findings = [];
  if (products < 1) findings.push('catalog_empty');
  if (classified !== products || totalAt(results, 2) > 0) findings.push('classification_version_incomplete');
  if (totalAt(results, 3) > 0) findings.push('classification_override_state_mismatch');
  if (totalAt(results, 4) > 0) findings.push('public_source_leak');
  if (totalAt(results, 5) > 0) findings.push('product_category_missing');
  if (totalAt(results, 6) > 0) findings.push('primary_media_missing');
  if (totalAt(results, 7) > 0) findings.push('product_media_count_mismatch');
  if (totalAt(results, 8) > 0) findings.push('product_media_orphan');
  if (totalAt(results, 9) > 0) findings.push('product_category_orphan');
  if (totalAt(results, 10) > 0) findings.push('product_facet_orphan');
  if (totalAt(results, 11) > 0) findings.push('category_count_mismatch');
  if (totalAt(results, 12) > 0) findings.push('team_count_mismatch');
  if (totalAt(results, 13) > 0) findings.push('league_count_mismatch');
  if (totalAt(results, 14) > 0) findings.push('facet_count_mismatch');
  if (intelligence !== products || totalAt(results, 16) > 0) {
    findings.push('intelligence_state_incomplete');
  }
  if (totalAt(results, 17) > 0) findings.push('intelligence_override_state_mismatch');
  return {
    products,
    classified,
    intelligence,
    deferredDetailCount: Math.max(0, Number(deferredDetailCount || 0)),
    reviewRequired: totalAt(results, 18),
    researchRequired: totalAt(results, 19),
    conflicts: totalAt(results, 20),
    findings: findings.slice(0, MAX_FINDINGS)
  };
}

async function runVerification(platform, context, fetchImpl) {
  const results = await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: verificationQueries()
    },
    { fetchImpl }
  );
  return verificationFindings(results, { deferredDetailCount: context.deferred_detail_count });
}

async function finishJob(db, job, context, report) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_verification_jobs
            SET status='success', product_count=?2, finding_count=0,
                findings_json='[]', next_attempt_at=NULL,
                finished_at=CURRENT_TIMESTAMP, last_error_code=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, report.products)
  ];
  if (context.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success', finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                  metadata_json=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='verify'`
        )
        .bind(
          context.provisioning_id,
          JSON.stringify({
            classifierVersion: CATALOG_CLASSIFIER_VERSION,
            products: report.products,
            intelligence: report.intelligence,
            deferredDetails: report.deferredDetailCount,
            reviewRequired: report.reviewRequired,
            researchRequired: report.researchRequired,
            conflicts: report.conflicts,
            findings: []
          })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='domain', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='verify'`
        )
        .bind(context.provisioning_id, job.tenant_id)
    );
  }
  await db.batch(statements);
}

async function failJob(db, job, context, errorCode, report = null) {
  const findings = report?.findings || [];
  const statements = [
    db
      .prepare(
        `UPDATE tenant_verification_jobs
            SET status='failed', product_count=?2, finding_count=?3,
                findings_json=?4, finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?5, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(
        job.job_id,
        Number(report?.products || 0),
        findings.length,
        JSON.stringify(findings),
        errorCode
      )
  ];
  if (context?.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='failed', finished_at=CURRENT_TIMESTAMP,
                  last_error=?2, metadata_json=?3, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='verify'`
        )
        .bind(
          context.provisioning_id,
          errorCode,
          JSON.stringify({
            findings,
            products: Number(report?.products || 0),
            intelligence: Number(report?.intelligence || 0),
            reviewRequired: Number(report?.reviewRequired || 0),
            researchRequired: Number(report?.researchRequired || 0),
            conflicts: Number(report?.conflicts || 0)
          })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='failed', current_step='verify', last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?3`
        )
        .bind(context.provisioning_id, errorCode, job.tenant_id)
    );
  }
  await db.batch(statements);
}

export async function processTenantVerification(db, { job, env }, { fetchImpl = fetch } = {}) {
  const platform = runtimeConfig(env);
  if (!platform) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const context = await loadContext(db, job.tenant_id);
  if (!context?.d1_database_id) return { outcome: 'blocked', reason: 'tenant_database_not_ready' };
  if (context.dispatch_namespace !== platform.dispatchNamespace) {
    return { outcome: 'failed', error: 'tenant_dispatch_namespace_mismatch' };
  }
  if (Number(context.schema_version || 0) < TENANT_DATA_PLANE_SCHEMA_VERSION) {
    return { outcome: 'blocked', reason: 'tenant_schema_not_ready' };
  }
  if (!(await claimJob(db, job, context))) return { outcome: 'busy', jobId: job.job_id };

  try {
    const report = await runVerification(platform, context, fetchImpl);
    if (report.findings.length) {
      await failJob(db, job, context, 'tenant_verification_findings', report);
      return { outcome: 'failed', jobId: job.job_id, error: 'tenant_verification_findings', ...report };
    }
    await finishJob(db, job, context, report);
    return { outcome: 'success', jobId: job.job_id, ...report };
  } catch (error) {
    const code =
      error instanceof CloudflarePlatformError ? error.code : 'tenant_verification_failed';
    await failJob(db, job, context, code);
    return { outcome: 'failed', jobId: job.job_id, error: code };
  }
}

export async function runDueTenantVerifications(env, { fetchImpl = fetch, limit = 1 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!runtimeConfig(env)) {
    return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 2);
  const discovered = await discoverCandidates(db, bounded);

  await db
    .prepare(
      `UPDATE tenant_verification_jobs
          SET status='failed', next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='verification_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-20 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id, classifier_version
         FROM tenant_verification_jobs
        WHERE status IN ('pending','failed')
          AND attempt_count < ?1
          AND classifier_version=?2
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?3`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, CATALOG_CLASSIFIER_VERSION, bounded)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantVerification(db, { job, env }, { fetchImpl });
    outcomes.push({ tenantId: job.tenant_id, jobId: job.job_id, ...result });
  }
  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    succeeded: outcomes.filter((item) => item.outcome === 'success').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    outcomes
  };
}
