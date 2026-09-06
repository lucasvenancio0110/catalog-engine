import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const ALLOWED_STAGES = new Set([
  'never',
  'entered',
  'configured',
  'discovered',
  'selected',
  'completed',
  'failed',
  'disabled'
]);

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function safeCode(value, fallback = 'none') {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_:-]{0,79}$/.test(code) ? code : fallback;
}

async function controlDatabaseId() {
  const raw = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const database = (config.d1_databases || []).find((entry) => entry?.binding === 'CATALOG_DB');
  if (!database?.database_id) throw new Error('pb9_control_database_missing');
  return String(database.database_id);
}

export function evaluateRuntimeSchedulerHeartbeat(row = {}) {
  const rawStage = String(row.stage || 'never').trim().toLowerCase();
  const stage = ALLOWED_STAGES.has(rawStage) ? rawStage : 'unknown';
  return {
    observed: stage !== 'never' && stage !== 'unknown',
    stage,
    discovered: integer(row.discovered_count),
    selected: integer(row.selected_count),
    processed: integer(row.processed_count),
    lastErrorCode: safeCode(row.last_error_code),
    heartbeatAgeSeconds: integer(row.heartbeat_age_seconds)
  };
}

export function safeRuntimeSchedulerHeartbeatEvidence(evaluation) {
  const evidence = {
    pb9RuntimeSchedulerHeartbeat: evaluation.observed ? 'observed' : 'not_observed',
    scheduler: evaluation
  };
  const serialized = JSON.stringify(evidence);
  if (/t_[a-f0-9]{20}|prn_[a-f0-9]{20}|rtjob_[a-f0-9]{20}|[a-f0-9]{8}-[a-f0-9-]{27,}|worker_script|workers\.dev|yupoo\.com|d1_database_id/i.test(serialized)) {
    throw new Error('pb9_runtime_scheduler_heartbeat_private_leak');
  }
  return evidence;
}

export async function runRuntimeSchedulerHeartbeatDiagnosis() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const databaseId = await controlDatabaseId();
  const result = await queryD1Batch({
    accountId,
    apiToken,
    databaseId,
    dispatchNamespace: 'catalog-engine-production',
    batch: [
      {
        sql: `SELECT stage,
                     discovered_count,
                     selected_count,
                     processed_count,
                     last_error_code,
                     MAX(0, CAST(strftime('%s','now') AS INTEGER) - CAST(strftime('%s',updated_at) AS INTEGER)) AS heartbeat_age_seconds
                FROM tenant_runtime_scheduler_state
               WHERE singleton_id=1
               LIMIT 1`,
        params: []
      }
    ]
  });
  const row = result?.[0]?.results?.[0] || {};
  const evidence = safeRuntimeSchedulerHeartbeatEvidence(
    evaluateRuntimeSchedulerHeartbeat(row)
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  runRuntimeSchedulerHeartbeatDiagnosis().catch(() => {
    console.error('pb9_runtime_scheduler_heartbeat_diagnosis_failed');
    process.exitCode = 1;
  });
}
