import fs from 'node:fs';
import { buildTenantSourceConnection, publicTenantSourceSummary } from '../src/domain/tenant-source-connection.js';
import { verifyYupooSourceUrl } from './yupoo-source-resolver.mjs';
import { buildTenantSourceConnectionSql } from './tenant-source-connection-core.mjs';

const tenantId = String(process.env.TENANT_ID || '').trim();
const sourceUrl = String(process.env.SOURCE_URL || '').trim();
const sourceKey = String(process.env.SOURCE_KEY || 'primary').trim();
const syncStrategy = String(process.env.SYNC_STRATEGY || 'incremental').trim();
const provisioningId = String(process.env.PROVISIONING_ID || '').trim() || null;
const sqlOut = process.env.TENANT_SOURCE_SQL_OUT || '/tmp/catalog-engine-source-connection.sql';
const summaryOut = process.env.TENANT_SOURCE_SUMMARY_OUT || '/tmp/catalog-engine-source-connection.json';
const validateNetwork = process.env.SOURCE_VALIDATE_NETWORK !== '0';

if (!tenantId) throw new Error('TENANT_ID is required.');
if (!sourceUrl) throw new Error('SOURCE_URL is required.');

let plan = buildTenantSourceConnection({ tenantId, sourceKey, sourceUrl, syncStrategy });
if (validateNetwork) {
  const resolvedUrl = await verifyYupooSourceUrl(plan.privateSource.canonicalUrl);
  plan = buildTenantSourceConnection({ tenantId, sourceKey, sourceUrl: resolvedUrl, syncStrategy });
}

fs.writeFileSync(sqlOut, buildTenantSourceConnectionSql(plan, { provisioningId }));
const summary = publicTenantSourceSummary(plan);
fs.writeFileSync(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
