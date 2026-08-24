import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryD1Batch } from '../worker/cloudflare-platform.js';

const API_ORIGIN = 'https://api.cloudflare.com';
const DEFAULT_DISPATCH_NAMESPACE = 'catalog-engine-production';
const PROVEN_FLEET_CANARY_RUN_ID = '32735316785';

export const RETAINED_FLEET_CANARY_FIXTURES = Object.freeze([
  { kind: 'success', tenantId: 't_bbd0a31ebb9924fd5e0d' },
  { kind: 'failure', tenantId: 't_35633dac7b86302d566b' },
  { kind: 'blocked', tenantId: 't_b4ac85a21b382cbeaea6' }
]);

function validateFixtureSet(fixtures) {
  if (fixtures.length !== 3) throw new Error('fleet_cleanup_fixture_set_incomplete');
  if (new Set(fixtures.map((fixture) => fixture.tenantId)).size !== fixtures.length) {
    throw new Error('fleet_cleanup_fixture_set_duplicate');
  }
  for (const fixture of fixtures) {
    if (!['success', 'failure', 'blocked'].includes(fixture.kind)) {
      throw new Error('fleet_cleanup_fixture_kind_invalid');
    }
    if (!/^t_[a-f0-9]{20}$/.test(fixture.tenantId)) {
      throw new Error('fleet_cleanup_fixture_tenant_invalid');
    }
  }
}

export function assertRetainedFleetFixture(fixture, row, dispatchNamespace) {
  const suffix = fixture.tenantId.slice(2);
  if (row.tenant_id !== fixture.tenantId) throw new Error('fleet_cleanup_tenant_mismatch');
  if (row.slug !== `fleet-canary-${suffix}`) throw new Error('fleet_cleanup_slug_mismatch');
  if (row.display_name !== `Fleet Migration Canary ${fixture.kind}`) {
    throw new Error('fleet_cleanup_display_name_mismatch');
  }
  if (row.source_key !== 'fleet-canary' || row.provider !== 'yupoo') {
    throw new Error('fleet_cleanup_source_mismatch');
  }
  if (row.source_url !== 'https://fleet-canary.invalid/catalog') {
    throw new Error('fleet_cleanup_source_url_mismatch');
  }
  if (row.worker_script_name !== `ce-${suffix}` || row.d1_database_name !== `cefm-${suffix}`) {
    throw new Error('fleet_cleanup_resource_identity_mismatch');
  }
  if (!/^[a-f0-9-]{32,40}$/i.test(String(row.d1_database_id || ''))) {
    throw new Error('fleet_cleanup_database_invalid');
  }
  const expectedNamespace =
    fixture.kind === 'failure' ? 'fleet-canary-namespace-mismatch' : dispatchNamespace;
  if (row.dispatch_namespace !== expectedNamespace) {
    throw new Error('fleet_cleanup_namespace_mismatch');
  }
}

function platformConfig(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  const dispatchNamespace = String(
    env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE || DEFAULT_DISPATCH_NAMESPACE
  ).trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('fleet_cleanup_account_invalid');
  if (apiToken.length < 20) throw new Error('fleet_cleanup_token_invalid');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(dispatchNamespace)) {
    throw new Error('fleet_cleanup_namespace_invalid');
  }
  if (String(env.PROVEN_FLEET_CANARY_RUN_ID || '') !== PROVEN_FLEET_CANARY_RUN_ID) {
    throw new Error('fleet_cleanup_production_proof_missing');
  }
  return { accountId, apiToken, dispatchNamespace };
}

async function cloudflareRequest(platform, path, { method = 'GET', allowNotFound = false } = {}) {
  const response = await fetch(new URL(path, API_ORIGIN), {
    method,
    redirect: 'error',
    headers: { authorization: `Bearer ${platform.apiToken}`, accept: 'application/json' }
  });
  if (allowNotFound && response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new Error('fleet_cleanup_cloudflare_request_failed');
  }
  return payload.result ?? null;
}

export async function cleanupRetainedFleetCanaries(env = process.env) {
  validateFixtureSet(RETAINED_FLEET_CANARY_FIXTURES);
  const platform = platformConfig(env);
  const wrangler = JSON.parse(
    await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  );
  if (String(wrangler.vars?.TENANT_SYNC_AUTOMATION_ENABLED || '') !== '0') {
    throw new Error('fleet_cleanup_requires_recurring_sync_off');
  }
  const controlDatabaseId = String(
    wrangler.d1_databases?.find((entry) => entry.binding === 'CATALOG_DB')?.database_id || ''
  ).trim();
  if (!/^[a-f0-9-]{32,40}$/i.test(controlDatabaseId)) {
    throw new Error('fleet_cleanup_control_database_invalid');
  }
  const controlBatch = (batch) =>
    queryD1Batch({ ...platform, databaseId: controlDatabaseId, batch });
  const placeholders = RETAINED_FLEET_CANARY_FIXTURES.map((_, index) => `?${index + 1}`).join(',');
  const params = RETAINED_FLEET_CANARY_FIXTURES.map((fixture) => fixture.tenantId);
  const result = await controlBatch([
    {
      sql: `SELECT t.tenant_id, t.slug, t.display_name,
                   p.dispatch_namespace, p.worker_script_name,
                   p.d1_database_name, p.d1_database_id,
                   s.source_key, s.provider, s.source_url
              FROM catalog_tenants t
              JOIN tenant_data_plane_provider_state p ON p.tenant_id=t.tenant_id
              JOIN supplier_sources s ON s.tenant_id=t.tenant_id
             WHERE t.tenant_id IN (${placeholders})
               AND s.source_key='fleet-canary'`,
      params
    }
  ]);
  const rows = result[0]?.results || [];
  const byTenant = new Map(rows.map((row) => [row.tenant_id, row]));

  for (const fixture of RETAINED_FLEET_CANARY_FIXTURES) {
    const row = byTenant.get(fixture.tenantId);
    if (row) assertRetainedFleetFixture(fixture, row, platform.dispatchNamespace);
  }

  for (const row of rows) {
    await cloudflareRequest(
      platform,
      `/client/v4/accounts/${platform.accountId}/workers/dispatch/namespaces/${encodeURIComponent(platform.dispatchNamespace)}/scripts/${encodeURIComponent(row.worker_script_name)}`,
      { method: 'DELETE', allowNotFound: true }
    );
    await cloudflareRequest(
      platform,
      `/client/v4/accounts/${platform.accountId}/d1/database/${encodeURIComponent(row.d1_database_id)}`,
      { method: 'DELETE', allowNotFound: true }
    );
  }

  if (rows.length) {
    await controlBatch(
      rows.map((row) => ({
        sql: 'DELETE FROM catalog_tenants WHERE tenant_id=?1',
        params: [row.tenant_id]
      }))
    );
  }
  const verification = await controlBatch([
    {
      sql: `SELECT COUNT(*) AS total FROM catalog_tenants WHERE tenant_id IN (${placeholders})`,
      params
    }
  ]);
  if (Number(verification[0]?.results?.[0]?.total || 0) !== 0) {
    throw new Error('fleet_cleanup_control_state_remaining');
  }

  return {
    retainedFleetCleanupPassed: true,
    provenFleetCanaryRunId: PROVEN_FLEET_CANARY_RUN_ID,
    targeted: RETAINED_FLEET_CANARY_FIXTURES.length,
    removed: rows.length,
    alreadyAbsent: RETAINED_FLEET_CANARY_FIXTURES.length - rows.length,
    controlStateRemoved: true,
    recurringSyncAutomationEnabled: false
  };
}

async function main() {
  console.log(JSON.stringify(await cleanupRetainedFleetCanaries(), null, 2));
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
