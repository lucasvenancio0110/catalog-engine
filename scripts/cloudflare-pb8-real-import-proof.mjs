import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const DEFAULT_MERCHANT = 'CROCCODILOS';
const DEFAULT_TENANT_ID = 't_00000000000000000001';
const SOURCE_KEY = 'primary';
const DISPATCH_NAMESPACE = 'catalog-engine-production';
const QUEUES = [
  'catalog-engine-import-scan',
  'catalog-engine-import-detail',
  'catalog-engine-import-scan-dlq',
  'catalog-engine-import-detail-dlq'
];

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function safeCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_]{1,80}$/.test(code) ? code : code ? 'other' : 'none';
}

async function loadRuntimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb8_control_database_missing');
  return {
    controlDatabaseId: String(database.database_id),
    initialImportEnabled: String(config.vars?.TENANT_IMPORT_AUTOMATION_ENABLED || '') === '1',
    recurringSyncEnabled: String(config.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') === '1'
  };
}

async function cfGet(accountId, apiToken, pathname) {
  const response = await fetch(new URL(pathname, API_ORIGIN), {
    method: 'GET',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json'
    }
  }).catch(() => null);
  if (!response) throw new Error('pb8_cloudflare_unreachable');
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error('pb8_cloudflare_query_failed');
  return payload.result ?? null;
}

async function queueBacklogs(accountId, apiToken) {
  const result = await cfGet(accountId, apiToken, `/client/v4/accounts/${accountId}/queues?per_page=100`);
  const rows = Array.isArray(result) ? result : [];
  const ids = new Map();
  for (const row of rows) {
    const name = String(row?.queue_name || row?.name || '').trim();
    const id = String(row?.queue_id || row?.id || '').trim();
    if (name && id) ids.set(name, id);
  }
  const output = {};
  for (const name of QUEUES) {
    const id = ids.get(name);
    if (!id) throw new Error('pb8_required_queue_missing');
    const metrics = await cfGet(
      accountId,
      apiToken,
      `/client/v4/accounts/${accountId}/queues/${encodeURIComponent(id)}/metrics`
    );
    const values = metrics?.metrics || metrics || {};
    output[name] = integer(values.backlog_count ?? values.backlogCount);
  }
  return output;
}

function firstRow(result, index) {
  return result?.[index]?.results?.[0] || null;
}

async function readControlState({ accountId, apiToken, databaseId, merchant }) {
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [
      {
        sql: `WITH target AS (
                SELECT tenant_id
                  FROM catalog_tenants
                 WHERE UPPER(display_name)=UPPER(?1)
                   AND status='active'
              )
              SELECT
                (SELECT COUNT(*) FROM target) AS tenant_count,
                t.tenant_id,
                p.d1_database_id,
                p.database_status,
                p.worker_status,
                i.status AS instance_status,
                i.schema_version,
                r.status AS provisioning_status,
                r.current_step AS provisioning_step,
                CASE WHEN t.tenant_id=?2 THEN 1 ELSE 0 END AS is_default_tenant
              FROM target t
              LEFT JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
              LEFT JOIN tenant_catalog_instances i ON i.tenant_id=t.tenant_id
              LEFT JOIN tenant_provisioning_runs r ON r.provisioning_id=(
                SELECT r2.provisioning_id FROM tenant_provisioning_runs r2
                 WHERE r2.tenant_id=t.tenant_id
                 ORDER BY r2.created_at DESC LIMIT 1
              )
              LIMIT 1`,
        params: [merchant, DEFAULT_TENANT_ID]
      },
      {
        sql: `SELECT j.import_id,j.status,j.phase,j.discovered_count,j.queued_detail_count,
                    j.completed_detail_count,j.failed_detail_count,j.deferred_detail_count,
                    j.published_product_count,j.next_attempt_at,j.started_at,j.finished_at,j.updated_at
                FROM tenant_import_jobs j
                JOIN catalog_tenants t ON t.tenant_id=j.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1)
                 AND t.status='active' AND j.source_key=?2 AND j.mode='initial'
               ORDER BY j.created_at DESC LIMIT 1`,
        params: [merchant, SOURCE_KEY]
      },
      {
        sql: `SELECT c.status,c.product_count,c.automatic_count,c.review_count,c.unknown_count,
                    c.next_attempt_at,c.started_at,c.finished_at,c.updated_at
                FROM tenant_classification_jobs c
                JOIN catalog_tenants t ON t.tenant_id=c.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1) AND t.status='active'
               ORDER BY c.created_at DESC LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT v.status,v.product_count,v.finding_count,v.next_attempt_at,
                    v.started_at,v.finished_at,v.updated_at
                FROM tenant_verification_jobs v
                JOIN catalog_tenants t ON t.tenant_id=v.tenant_id
               WHERE UPPER(t.display_name)=UPPER(?1) AND t.status='active'
               ORDER BY v.created_at DESC LIMIT 1`,
        params: [merchant]
      },
      {
        sql: `SELECT COUNT(*) AS total FROM catalog_products`,
        params: []
      }
    ]
  });
  return {
    target: firstRow(result, 0),
    importJob: firstRow(result, 1),
    classificationJob: firstRow(result, 2),
    verificationJob: firstRow(result, 3),
    defaultCatalogProductCount: integer(firstRow(result, 4)?.total)
  };
}

async function readTenantDataPlaneState({ accountId, apiToken, databaseId, tenantId, importId }) {
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [
      {
        sql: `SELECT state,last_error_code,COUNT(*) AS total
                FROM supplier_album_detail_state
               WHERE tenant_id=?1 AND source_key=?2 AND import_id=?3
               GROUP BY state,last_error_code
               ORDER BY state,last_error_code`,
        params: [tenantId, SOURCE_KEY, importId]
      },
      {
        sql: `SELECT COUNT(*) AS total FROM catalog_products`,
        params: []
      },
      {
        sql: `SELECT COUNT(*) AS total FROM product_media`,
        params: []
      }
    ]
  });
  return {
    detailRows: result?.[0]?.results || [],
    productCount: integer(firstRow(result, 1)?.total),
    productMediaCount: integer(firstRow(result, 2)?.total)
  };
}

function detailSummary(rows, discovered) {
  const states = { pending: 0, processing: 0, failed: 0, success: 0, skipped: 0, deferred: 0 };
  const errors = new Map();
  let tracked = 0;
  for (const row of rows || []) {
    const state = String(row?.state || '').trim();
    const count = integer(row?.total);
    tracked += count;
    if (Object.hasOwn(states, state)) states[state] += count;
    const code = safeCode(row?.last_error_code);
    if (code !== 'none' && count > 0) errors.set(code, (errors.get(code) || 0) + count);
  }
  const terminal = states.success + states.skipped + states.deferred;
  return {
    tracked,
    untracked: Math.max(0, integer(discovered) - tracked),
    terminal,
    states,
    errors: [...errors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([code, count]) => ({ code, count }))
  };
}

export function evaluatePb8RealImport({ control, tenant, queues, runtime }) {
  const target = control?.target || {};
  const importJob = control?.importJob || {};
  const classification = control?.classificationJob || null;
  const verification = control?.verificationJob || null;
  const discovered = integer(importJob.discovered_count);
  const details = detailSummary(tenant?.detailRows || [], discovered);
  const detailBacklog = integer(queues?.['catalog-engine-import-detail']);
  const scanDlq = integer(queues?.['catalog-engine-import-scan-dlq']);
  const detailDlq = integer(queues?.['catalog-engine-import-detail-dlq']);

  const checks = {
    uniqueMerchant: integer(target.tenant_count) === 1,
    isolatedTenant: integer(target.is_default_tenant) === 0,
    dataPlaneActive: target.database_status === 'active' && target.worker_status === 'active',
    schemaV8: integer(target.schema_version) >= 8,
    initialImportEnabled: runtime?.initialImportEnabled === true,
    recurringSyncDisabled: runtime?.recurringSyncEnabled === false,
    importComplete: importJob.status === 'success' && importJob.phase === 'complete',
    tenantProductsPresent: integer(tenant?.productCount) > 0,
    classificationComplete: classification?.status === 'success',
    verificationComplete: verification?.status === 'success',
    verificationClean: integer(verification?.finding_count) === 0,
    scanDlqClean: scanDlq === 0,
    detailDlqClean: detailDlq === 0
  };

  let diagnosis = 'ready';
  if (!checks.uniqueMerchant || !checks.isolatedTenant || !checks.dataPlaneActive || !checks.schemaV8) {
    diagnosis = 'tenant_runtime_not_ready';
  } else if (!checks.importComplete) {
    if (detailDlq > 0 || scanDlq > 0) diagnosis = 'import_dlq_present';
    else if (detailBacklog > 0) diagnosis = 'detail_queue_draining';
    else if (details.untracked > 0) diagnosis = 'detail_delivery_gap';
    else if (details.terminal < discovered) diagnosis = 'detail_retry_pending';
    else diagnosis = 'finalization_pending';
  } else if (!checks.classificationComplete) {
    diagnosis = 'classification_pending';
  } else if (!checks.verificationComplete) {
    diagnosis = 'verification_pending';
  } else if (!checks.verificationClean) {
    diagnosis = 'verification_findings';
  } else if (!checks.scanDlqClean || !checks.detailDlqClean) {
    diagnosis = 'queue_hygiene_not_clean';
  }

  return {
    passed: Object.values(checks).every(Boolean),
    diagnosis,
    checks,
    import: {
      status: String(importJob.status || 'missing'),
      phase: String(importJob.phase || 'missing'),
      discovered,
      queued: integer(importJob.queued_detail_count),
      terminalDetails: details.terminal
    },
    details,
    tenantCatalog: {
      products: integer(tenant?.productCount),
      mediaLinks: integer(tenant?.productMediaCount)
    },
    classification: classification
      ? {
          status: String(classification.status || 'missing'),
          products: integer(classification.product_count),
          automatic: integer(classification.automatic_count),
          review: integer(classification.review_count),
          unknown: integer(classification.unknown_count)
        }
      : null,
    verification: verification
      ? {
          status: String(verification.status || 'missing'),
          products: integer(verification.product_count),
          findings: integer(verification.finding_count)
        }
      : null,
    queues: {
      scan: integer(queues?.['catalog-engine-import-scan']),
      detail: detailBacklog,
      scanDlq,
      detailDlq
    },
    defaultCatalogProductCount: integer(control?.defaultCatalogProductCount)
  };
}

export function safePb8Evidence(merchant, evaluation) {
  const evidence = {
    pb8ProductionProof: evaluation.passed ? 'passed' : 'pending',
    merchant: String(merchant || DEFAULT_MERCHANT).slice(0, 80),
    diagnosis: evaluation.diagnosis,
    import: evaluation.import,
    details: evaluation.details,
    tenantCatalog: evaluation.tenantCatalog,
    classification: evaluation.classification,
    verification: evaluation.verification,
    queues: evaluation.queues,
    defaultCatalogProductCount: evaluation.defaultCatalogProductCount,
    initialImportEnabled: evaluation.checks.initialImportEnabled,
    recurringIntelligentSyncEnabled: !evaluation.checks.recurringSyncDisabled,
    privateIdentifiersExposed: false
  };
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|pv_[a-f0-9]{20}|loc_[a-f0-9]{20}|https?:\/\/|yupoo\.com|d1_database_id|worker_script|dispatch_namespace|source_locator/i.test(serialized)) {
    throw new Error('pb8_safe_evidence_private_leak');
  }
  return evidence;
}

export async function runPb8RealImportProof() {
  const merchant = String(process.env.PB8_MERCHANT_DISPLAY_NAME || DEFAULT_MERCHANT).trim();
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const runtime = await loadRuntimeConfig();
  const control = await readControlState({
    accountId,
    apiToken,
    databaseId: runtime.controlDatabaseId,
    merchant
  });

  if (integer(control.target?.tenant_count) !== 1) throw new Error('pb8_merchant_not_unique');
  const tenantId = String(control.target?.tenant_id || '');
  const tenantDatabaseId = String(control.target?.d1_database_id || '');
  const importId = String(control.importJob?.import_id || '');
  if (!/^t_[a-f0-9]{20}$/.test(tenantId)) throw new Error('pb8_tenant_identity_missing');
  if (!/^[a-f0-9-]{32,40}$/i.test(tenantDatabaseId)) throw new Error('pb8_tenant_database_missing');
  if (!/^imp_[a-f0-9]{20}$/.test(importId)) throw new Error('pb8_initial_import_missing');

  const [tenant, queues] = await Promise.all([
    readTenantDataPlaneState({ accountId, apiToken, databaseId: tenantDatabaseId, tenantId, importId }),
    queueBacklogs(accountId, apiToken)
  ]);
  const evaluation = evaluatePb8RealImport({ control, tenant, queues, runtime });
  const evidence = safePb8Evidence(merchant, evaluation);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8RealImportProof().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
