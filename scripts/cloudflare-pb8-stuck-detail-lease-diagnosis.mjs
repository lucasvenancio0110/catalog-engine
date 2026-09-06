import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const MERCHANT = String(process.env.PB8_MERCHANT_DISPLAY_NAME || 'CROCCODILOS').trim();
const DISPATCH_NAMESPACE = 'catalog-engine-production';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function runtimeConfig() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb8_stuck_control_database_missing');
  return { databaseId: String(database.database_id) };
}

async function targetIdentity({ accountId, apiToken, databaseId }) {
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId,
    batch: [{
      sql: `SELECT t.tenant_id,p.d1_database_id,j.import_id
              FROM catalog_tenants t
              JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
              JOIN tenant_import_jobs j ON j.tenant_id=t.tenant_id
             WHERE UPPER(t.display_name)=UPPER(?1)
               AND t.status='active' AND j.source_key='primary' AND j.mode='initial'
             ORDER BY j.created_at DESC LIMIT 2`,
      params: [MERCHANT]
    }]
  });
  const rows = result?.[0]?.results || [];
  if (rows.length !== 1) throw new Error('pb8_stuck_identity_ambiguous');
  const row = rows[0];
  if (!/^t_[a-f0-9]{20}$/.test(String(row.tenant_id || ''))) throw new Error('pb8_stuck_tenant_invalid');
  if (!/^imp_[a-f0-9]{20}$/.test(String(row.import_id || ''))) throw new Error('pb8_stuck_import_invalid');
  if (!/^[a-f0-9-]{32,40}$/i.test(String(row.d1_database_id || ''))) throw new Error('pb8_stuck_database_invalid');
  return { tenantId: row.tenant_id, importId: row.import_id, databaseId: row.d1_database_id };
}

export function summarizeStuckDetailRows(rows = []) {
  const summary = {
    nonTerminal: 0,
    processing: 0,
    pending: 0,
    failed: 0,
    expiredProcessingLease: 0,
    attemptsAtOrAboveDetailLimit: 0,
    attempts: {},
    errors: {}
  };
  for (const row of rows) {
    const count = Math.max(0, Math.floor(Number(row.total || 0)));
    const state = String(row.state || 'unknown');
    const attempt = Math.max(0, Math.floor(Number(row.attempt_count || 0)));
    summary.nonTerminal += count;
    if (state === 'processing') summary.processing += count;
    if (state === 'pending') summary.pending += count;
    if (state === 'failed') summary.failed += count;
    if (state === 'processing' && Number(row.lease_expired || 0) === 1) summary.expiredProcessingLease += count;
    if (attempt >= 4) summary.attemptsAtOrAboveDetailLimit += count;
    summary.attempts[String(attempt)] = (summary.attempts[String(attempt)] || 0) + count;
    const code = String(row.last_error_code || '').trim().toLowerCase();
    if (code && /^[a-z0-9_]{1,80}$/.test(code)) summary.errors[code] = (summary.errors[code] || 0) + count;
  }
  return summary;
}

function assertSafeEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|imp_[a-f0-9]{20}|https?:\/\/|yupoo\.com|album_source_id|claim_token|lease_until|d1_database/i.test(serialized)) {
    throw new Error('pb8_stuck_private_evidence_leak');
  }
}

export async function runPb8StuckDetailLeaseDiagnosis() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const { databaseId: controlDatabaseId } = await runtimeConfig();
  const target = await targetIdentity({ accountId, apiToken, databaseId: controlDatabaseId });
  const result = await queryD1Batch({
    accountId,
    apiToken,
    dispatchNamespace: DISPATCH_NAMESPACE,
    databaseId: target.databaseId,
    batch: [{
      sql: `SELECT state,attempt_count,last_error_code,
                  CASE WHEN state='processing' AND lease_until IS NOT NULL
                            AND lease_until<=CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS lease_expired,
                  COUNT(*) AS total
             FROM supplier_album_detail_state
            WHERE tenant_id=?1 AND source_key='primary' AND import_id=?2
              AND state NOT IN ('success','skipped','deferred')
            GROUP BY state,attempt_count,last_error_code,lease_expired
            ORDER BY state,attempt_count,last_error_code`,
      params: [target.tenantId, target.importId]
    }]
  });
  const evidence = {
    pb8StuckDetailLeaseDiagnosis: 'observed',
    merchant: MERCHANT.slice(0, 80),
    ...summarizeStuckDetailRows(result?.[0]?.results || []),
    readOnly: true,
    privateIdentifiersExposed: false
  };
  assertSafeEvidence(evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runPb8StuckDetailLeaseDiagnosis().catch((error) => {
    console.error(String(error?.message || error).slice(0, 120));
    process.exitCode = 1;
  });
}
