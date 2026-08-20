import { createTenantCatalogEvidence } from '../src/catalog-intelligence/core/runtime-evidence.js';
import {
  CATALOG_CLASSIFIER_KEY,
  CATALOG_CLASSIFIER_VERSION,
  classifyCatalogEvidence
} from '../src/domain/catalog-classifier.js';
import { FACETS, LEAGUES, TEAMS } from '../src/domain/catalog-normalization.js';
import { CloudflarePlatformError, queryD1Batch } from './cloudflare-platform.js';
import { stableOpaqueId } from './runtime-identity.js';

const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const MAX_AUTOMATIC_ATTEMPTS = 5;
const PRODUCT_PAGE_SIZE = 100;
const PAGES_PER_RUN = 5;
const D1_WRITE_BATCH_LIMIT = 90;

function runtimeConfig(env) {
  const accountId = String(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_PLATFORM_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || !dispatchNamespace) return null;
  return { accountId, apiToken, dispatchNamespace };
}

async function classificationJobId(tenantId) {
  return stableOpaqueId(
    'clsjob',
    `${tenantId}:${CATALOG_CLASSIFIER_KEY}:v${CATALOG_CLASSIFIER_VERSION}`
  );
}

async function discoverCandidates(db, limit) {
  const result = await db
    .prepare(
      `SELECT DISTINCT r.tenant_id
         FROM tenant_provisioning_runs r
         JOIN tenant_catalog_instances i ON i.tenant_id=r.tenant_id
         JOIN tenant_data_plane_provider_state p ON p.tenant_id=r.tenant_id
         JOIN tenant_import_jobs j ON j.tenant_id=r.tenant_id AND j.status='success'
        WHERE r.current_step='classify'
          AND r.status IN ('running','failed','blocked')
          AND i.status='provisioning'
          AND i.schema_version >= 3
          AND p.database_status='active'
          AND p.worker_status='active'
          AND p.d1_database_id IS NOT NULL
        ORDER BY r.created_at ASC
        LIMIT ?1`
    )
    .bind(limit)
    .all();

  for (const row of result.results || []) {
    const jobId = await classificationJobId(row.tenant_id);
    await db
      .prepare(
        `INSERT INTO tenant_classification_jobs
          (job_id, tenant_id, classifier_version, classifier_key, status, attempt_count,
           next_attempt_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(job_id) DO UPDATE SET
           status=CASE
             WHEN tenant_classification_jobs.status IN ('running','success') THEN tenant_classification_jobs.status
             ELSE 'pending'
           END,
           next_attempt_at=CASE
             WHEN tenant_classification_jobs.status IN ('running','success') THEN tenant_classification_jobs.next_attempt_at
             ELSE CURRENT_TIMESTAMP
           END,
           last_error_code=CASE
             WHEN tenant_classification_jobs.status IN ('running','success') THEN tenant_classification_jobs.last_error_code
             ELSE NULL
           END,
           updated_at=CURRENT_TIMESTAMP`
      )
      .bind(jobId, row.tenant_id, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY)
      .run();
  }
  return (result.results || []).length;
}

async function loadContext(db, tenantId) {
  return db
    .prepare(
      `SELECT p.d1_database_id, p.dispatch_namespace,
              r.provisioning_id, i.schema_version,
              s.source_key, s.provider
         FROM tenant_data_plane_provider_state p
         JOIN tenant_catalog_instances i ON i.tenant_id=p.tenant_id
         JOIN supplier_sources s ON s.tenant_id=p.tenant_id AND s.status='active'
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
        ORDER BY s.created_at ASC
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function claimJob(db, job, context) {
  const result = await db
    .prepare(
      `UPDATE tenant_classification_jobs
          SET status='running',
              started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
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
              SET status='running',
                  started_at=COALESCE(started_at,CURRENT_TIMESTAMP), finished_at=NULL,
                  last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='classify'`
        )
        .bind(context.provisioning_id),
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='classify', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2`
        )
        .bind(context.provisioning_id, job.tenant_id)
    ]);
  }
  return true;
}

async function sourceCategoryNames(platform, context, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: [
        {
          sql: `SELECT category_source_id, name
                  FROM supplier_category_index
                 WHERE tenant_id=?1 AND source_key=?2`,
          params: [context.tenant_id, context.source_key]
        }
      ]
    },
    { fetchImpl }
  );
  return new Map(
    (result[0]?.results || []).map((row) => [String(row.category_source_id), String(row.name || '')])
  );
}

async function productPage(platform, context, cursor, fetchImpl) {
  const result = await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: [
        {
          sql: `SELECT p.product_id, p.source_name, p.name, p.description,
                       p.source_category_name, p.category_name,
                       a.album_source_id, a.source_category_path_json,
                       o.override_json
                  FROM catalog_products p
                  LEFT JOIN supplier_album_index a
                    ON a.tenant_id=?1 AND a.source_key=?2 AND a.public_product_id=p.product_id
                  LEFT JOIN catalog_product_classification_overrides o
                    ON o.product_id=p.product_id
                 WHERE (?3 IS NULL OR p.product_id > ?3)
                 ORDER BY p.product_id ASC
                 LIMIT ?4`,
          params: [context.tenant_id, context.source_key, cursor || null, PRODUCT_PAGE_SIZE]
        }
      ]
    },
    { fetchImpl }
  );
  return result[0]?.results || [];
}

function categoryPathNames(row, categoryNames) {
  let ids = [];
  try {
    ids = JSON.parse(row.source_category_path_json || '[]');
  } catch {
    ids = [];
  }
  return ids.map((id) => categoryNames.get(String(id))).filter(Boolean);
}

function leagueStatement(league) {
  return {
    sql: `INSERT INTO catalog_leagues
            (league_id, name, country_code, country_name, entity_type, logo_url, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(league_id) DO UPDATE SET
            name=excluded.name, country_code=excluded.country_code, country_name=excluded.country_name,
            entity_type=excluded.entity_type, logo_url=excluded.logo_url,
            sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
    params: [
      league.id,
      league.name,
      league.countryCode,
      league.countryName,
      league.entityType,
      league.logoUrl || null,
      Number(league.sortOrder || 0)
    ]
  };
}

function teamStatement(team) {
  return {
    sql: `INSERT INTO catalog_teams
            (team_id, name, short_name, league_id, country_code, entity_type, logo_url, initials, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(team_id) DO UPDATE SET
            name=excluded.name, short_name=excluded.short_name, league_id=excluded.league_id,
            country_code=excluded.country_code, entity_type=excluded.entity_type,
            logo_url=excluded.logo_url, initials=excluded.initials,
            sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
    params: [
      team.id,
      team.name,
      team.shortName,
      team.leagueId || null,
      team.countryCode || null,
      team.entityType,
      team.logoUrl || null,
      team.initials,
      Number(team.sortOrder || 0)
    ]
  };
}

function facetStatement(facet) {
  return {
    sql: `INSERT INTO catalog_facets
            (facet_id, facet_type, name, sort_order, product_count, updated_at)
          VALUES (?1, ?2, ?3, ?4, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(facet_id) DO UPDATE SET
            facet_type=excluded.facet_type, name=excluded.name,
            sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`,
    params: [facet.id, facet.type, facet.name, Number(facet.sortOrder || 0)]
  };
}

async function runBoundedBatches(platform, databaseId, statements, fetchImpl) {
  for (let index = 0; index < statements.length; index += D1_WRITE_BATCH_LIMIT) {
    await queryD1Batch(
      {
        ...platform,
        databaseId,
        batch: statements.slice(index, index + D1_WRITE_BATCH_LIMIT)
      },
      { fetchImpl }
    );
  }
}

async function seedControlledEntities(platform, context, fetchImpl) {
  await runBoundedBatches(
    platform,
    context.d1_database_id,
    [...LEAGUES.map(leagueStatement), ...TEAMS.map(teamStatement), ...FACETS.map(facetStatement)],
    fetchImpl
  );
}

function productClassificationStatements(row, classified) {
  const statements = [
    {
      sql: `UPDATE catalog_products
               SET name=?2, search_text=?3, category_name=?4,
                   display_name=?2, display_category_name=?4,
                   team_id=?5, league_id=?6,
                   classification_status=?7, classification_confidence=?8,
                   updated_at=CURRENT_TIMESTAMP
             WHERE product_id=?1`,
      params: [
        row.product_id,
        classified.displayName,
        classified.searchText,
        classified.displayCategoryName,
        classified.team?.id || null,
        classified.league?.id || null,
        classified.classificationStatus,
        classified.classificationConfidence
      ]
    },
    { sql: 'DELETE FROM catalog_product_facets WHERE product_id=?1', params: [row.product_id] }
  ];
  for (const facet of classified.facets) {
    statements.push({
      sql: 'INSERT OR IGNORE INTO catalog_product_facets (product_id, facet_id) VALUES (?1, ?2)',
      params: [row.product_id, facet.id]
    });
  }
  statements.push({
    sql: `INSERT INTO catalog_product_classification_state
            (product_id, classifier_version, classifier_key, override_applied, classified_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            classifier_version=excluded.classifier_version,
            classifier_key=excluded.classifier_key,
            override_applied=excluded.override_applied,
            classified_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP`,
    params: [
      row.product_id,
      CATALOG_CLASSIFIER_VERSION,
      CATALOG_CLASSIFIER_KEY,
      classified.overrideApplied ? 1 : 0
    ]
  });
  return statements;
}

async function writeProductGroups(platform, databaseId, groups, fetchImpl) {
  let current = [];
  for (const group of groups) {
    if (group.length > 100) throw new Error('tenant_classification_product_write_too_large');
    if (current.length && current.length + group.length > D1_WRITE_BATCH_LIMIT) {
      await queryD1Batch({ ...platform, databaseId, batch: current }, { fetchImpl });
      current = [];
    }
    current.push(...group);
  }
  if (current.length) {
    await queryD1Batch({ ...platform, databaseId, batch: current }, { fetchImpl });
  }
}

async function classifyPage(platform, context, categoryNames, cursor, fetchImpl) {
  const rows = await productPage(platform, context, cursor, fetchImpl);
  if (!rows.length) return { rows: 0, cursor, automatic: 0, review: 0, unknown: 0 };
  const groups = [];
  let automatic = 0;
  let review = 0;
  let unknown = 0;
  for (const row of rows) {
    const evidence = createTenantCatalogEvidence(
      row,
      context,
      categoryPathNames(row, categoryNames)
    );
    const classified = classifyCatalogEvidence(evidence, row.override_json || null);
    groups.push(productClassificationStatements(row, classified));
    if (classified.classificationStatus === 'automatic') automatic += 1;
    else if (classified.classificationStatus === 'needs_review') review += 1;
    else unknown += 1;
  }
  await writeProductGroups(platform, context.d1_database_id, groups, fetchImpl);
  return {
    rows: rows.length,
    cursor: String(rows.at(-1).product_id),
    automatic,
    review,
    unknown
  };
}

async function persistProgress(db, jobId, page) {
  await db
    .prepare(
      `UPDATE tenant_classification_jobs
          SET cursor_product_id=?2,
              product_count=product_count+?3,
              automatic_count=automatic_count+?4,
              review_count=review_count+?5,
              unknown_count=unknown_count+?6,
              chunk_count=chunk_count+1,
              updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status='running'`
    )
    .bind(jobId, page.cursor, page.rows, page.automatic, page.review, page.unknown)
    .run();
}

async function releasePartialJob(db, jobId) {
  await db
    .prepare(
      `UPDATE tenant_classification_jobs
          SET status='pending', next_attempt_at=CURRENT_TIMESTAMP,
              last_error_code=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE job_id=?1 AND status='running'`
    )
    .bind(jobId)
    .run();
}

async function currentCounters(db, jobId) {
  return db
    .prepare(
      `SELECT product_count, automatic_count, review_count, unknown_count, cursor_product_id
         FROM tenant_classification_jobs WHERE job_id=?1 LIMIT 1`
    )
    .bind(jobId)
    .first();
}

async function finalizeD1Classification(platform, context, stats, fetchImpl) {
  const classificationMeta = JSON.stringify({
    version: CATALOG_CLASSIFIER_VERSION,
    key: CATALOG_CLASSIFIER_KEY,
    classified: stats.automatic,
    needsReview: stats.review,
    unknown: stats.unknown,
    products: stats.productCount
  });
  const normalizationMeta = JSON.stringify({
    version: CATALOG_CLASSIFIER_VERSION,
    classified: stats.automatic,
    needsReview: stats.review,
    unknown: stats.unknown
  });
  await queryD1Batch(
    {
      ...platform,
      databaseId: context.d1_database_id,
      batch: [
        {
          sql: `UPDATE catalog_leagues
                   SET product_count=(SELECT COUNT(*) FROM catalog_products p WHERE p.league_id=catalog_leagues.league_id),
                       updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        {
          sql: `UPDATE catalog_teams
                   SET product_count=(SELECT COUNT(*) FROM catalog_products p WHERE p.team_id=catalog_teams.team_id),
                       updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        {
          sql: `UPDATE catalog_facets
                   SET product_count=(SELECT COUNT(*) FROM catalog_product_facets pf WHERE pf.facet_id=catalog_facets.facet_id),
                       updated_at=CURRENT_TIMESTAMP`,
          params: []
        },
        { sql: 'DELETE FROM catalog_leagues WHERE product_count=0', params: [] },
        { sql: 'DELETE FROM catalog_teams WHERE product_count=0', params: [] },
        { sql: 'DELETE FROM catalog_facets WHERE product_count=0', params: [] },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('classification', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [classificationMeta]
        },
        {
          sql: `INSERT INTO catalog_meta (key, value_json, updated_at)
                VALUES ('normalization', ?1, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP`,
          params: [normalizationMeta]
        }
      ]
    },
    { fetchImpl }
  );
}

async function finishJob(db, job, context, stats) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_classification_jobs
            SET status='success', next_attempt_at=NULL,
                finished_at=CURRENT_TIMESTAMP, last_error_code=NULL,
                updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1 AND status='running'`
      )
      .bind(job.job_id)
  ];
  if (context.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='success',
                  attempt_count=CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                  finished_at=CURRENT_TIMESTAMP, last_error=NULL,
                  metadata_json=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='classify'`
        )
        .bind(
          context.provisioning_id,
          JSON.stringify({
            classifierVersion: CATALOG_CLASSIFIER_VERSION,
            classifierKey: CATALOG_CLASSIFIER_KEY,
            ...stats
          })
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='running', current_step='verify', last_error=NULL, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?2 AND current_step='classify'`
        )
        .bind(context.provisioning_id, job.tenant_id)
    );
  }
  await db.batch(statements);
}

async function failJob(db, job, context, safeCode) {
  const statements = [
    db
      .prepare(
        `UPDATE tenant_classification_jobs
            SET status='failed', attempt_count=attempt_count+1,
                finished_at=CURRENT_TIMESTAMP,
                next_attempt_at=datetime(CURRENT_TIMESTAMP,'+10 minutes'),
                last_error_code=?2, updated_at=CURRENT_TIMESTAMP
          WHERE job_id=?1`
      )
      .bind(job.job_id, safeCode)
  ];
  if (context?.provisioning_id) {
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_steps
              SET status='failed', finished_at=CURRENT_TIMESTAMP,
                  last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND step_key='classify'`
        )
        .bind(context.provisioning_id, safeCode)
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_provisioning_runs
              SET status='failed', current_step='classify', last_error=?2, updated_at=CURRENT_TIMESTAMP
            WHERE provisioning_id=?1 AND tenant_id=?3`
        )
        .bind(context.provisioning_id, safeCode, job.tenant_id)
    );
  }
  await db.batch(statements);
}

function safeError(error) {
  if (error instanceof CloudflarePlatformError) return error.code;
  if (String(error?.message || '') === 'cei_runtime_evidence_invalid') {
    return 'tenant_classification_evidence_invalid';
  }
  if (error?.name === 'ZodError' || /^classification_override_/.test(String(error?.message || ''))) {
    return 'tenant_classification_override_invalid';
  }
  return 'tenant_classification_failed';
}

export async function processTenantClassification(db, { job, env }, { fetchImpl = fetch } = {}) {
  const platform = runtimeConfig(env);
  if (!platform) return { outcome: 'queued', reason: 'cloudflare_platform_unconfigured' };
  const context = await loadContext(db, job.tenant_id);
  if (!context?.d1_database_id) return { outcome: 'blocked', reason: 'tenant_database_not_ready' };
  context.tenant_id = job.tenant_id;
  if (context.dispatch_namespace !== platform.dispatchNamespace) {
    return { outcome: 'failed', error: 'tenant_dispatch_namespace_mismatch' };
  }
  if (Number(context.schema_version || 0) < 3) {
    return { outcome: 'blocked', reason: 'tenant_schema_not_ready' };
  }
  if (!(await claimJob(db, job, context))) return { outcome: 'busy', jobId: job.job_id };

  try {
    const categoryNames = await sourceCategoryNames(platform, context, fetchImpl);
    if (!job.cursor_product_id) await seedControlledEntities(platform, context, fetchImpl);
    let cursor = job.cursor_product_id || null;
    let complete = false;

    for (let pageIndex = 0; pageIndex < PAGES_PER_RUN; pageIndex += 1) {
      const page = await classifyPage(platform, context, categoryNames, cursor, fetchImpl);
      if (!page.rows) {
        complete = true;
        break;
      }
      await persistProgress(db, job.job_id, page);
      cursor = page.cursor;
      if (page.rows < PRODUCT_PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    if (!complete) {
      await releasePartialJob(db, job.job_id);
      const counters = await currentCounters(db, job.job_id);
      return {
        outcome: 'partial',
        jobId: job.job_id,
        processed: Number(counters?.product_count || 0),
        cursor: counters?.cursor_product_id || cursor
      };
    }

    const counters = await currentCounters(db, job.job_id);
    const stats = {
      productCount: Number(counters?.product_count || 0),
      automatic: Number(counters?.automatic_count || 0),
      review: Number(counters?.review_count || 0),
      unknown: Number(counters?.unknown_count || 0)
    };
    if (stats.productCount < 1) throw new Error('tenant_classification_empty_catalog');
    await finalizeD1Classification(platform, context, stats, fetchImpl);
    await finishJob(db, job, context, stats);
    return { outcome: 'success', jobId: job.job_id, ...stats };
  } catch (error) {
    const code = safeError(error);
    await failJob(db, job, context, code);
    return { outcome: 'failed', jobId: job.job_id, error: code };
  }
}

export async function runDueTenantClassifications(env, { fetchImpl = fetch, limit = 1 } = {}) {
  if (!env.CATALOG_DB) return { enabled: false, reason: 'database_unbound', processed: 0 };
  if (!runtimeConfig(env)) {
    return { enabled: false, reason: 'cloudflare_platform_unconfigured', processed: 0 };
  }
  const db = env.CATALOG_DB;
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 2);
  const discovered = await discoverCandidates(db, bounded);

  await db
    .prepare(
      `UPDATE tenant_classification_jobs
          SET status='failed', attempt_count=attempt_count+1,
              next_attempt_at=CURRENT_TIMESTAMP,
              finished_at=CURRENT_TIMESTAMP, last_error_code='classification_job_stale_reclaimed',
              updated_at=CURRENT_TIMESTAMP
        WHERE status='running' AND updated_at <= datetime(CURRENT_TIMESTAMP,'-30 minutes')`
    )
    .run();

  const due = await db
    .prepare(
      `SELECT job_id, tenant_id, classifier_version, classifier_key,
              cursor_product_id, product_count, automatic_count, review_count, unknown_count
         FROM tenant_classification_jobs
        WHERE status IN ('pending','failed')
          AND attempt_count < ?1
          AND classifier_version=?2 AND classifier_key=?3
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?4`
    )
    .bind(MAX_AUTOMATIC_ATTEMPTS, CATALOG_CLASSIFIER_VERSION, CATALOG_CLASSIFIER_KEY, bounded)
    .all();

  const outcomes = [];
  for (const job of due.results || []) {
    const result = await processTenantClassification(db, { job, env }, { fetchImpl });
    outcomes.push({ tenantId: job.tenant_id, jobId: job.job_id, ...result });
  }
  return {
    enabled: true,
    discovered,
    selected: (due.results || []).length,
    processed: outcomes.length,
    partial: outcomes.filter((item) => item.outcome === 'partial').length,
    succeeded: outcomes.filter((item) => item.outcome === 'success').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    outcomes
  };
}
