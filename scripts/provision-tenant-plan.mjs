import { writeFile } from 'node:fs/promises';
import { buildTenantProvisioningPlan, publicProvisioningSummary } from '../src/domain/tenant-provisioning.js';
import { buildTenantProvisioningSql } from './tenant-provisioning-core.mjs';

const storeName = process.env.STORE_NAME;
const slug = process.env.STORE_SLUG;
if (!storeName || !slug) {
  throw new Error('STORE_NAME and STORE_SLUG are required.');
}

const plan = buildTenantProvisioningPlan({
  storeName,
  slug,
  themeKey: process.env.THEME_KEY || 'premium-dark',
  currency: process.env.CURRENCY || 'BRL',
  ownerPrincipalId: process.env.OWNER_PRINCIPAL_ID || null,
  platformBaseDomain: process.env.PLATFORM_BASE_DOMAIN || null
});

if (process.env.TENANT_PROVISION_SQL_OUT) {
  await writeFile(process.env.TENANT_PROVISION_SQL_OUT, buildTenantProvisioningSql(plan), 'utf8');
}
if (process.env.TENANT_PROVISION_PLAN_OUT) {
  await writeFile(
    process.env.TENANT_PROVISION_PLAN_OUT,
    `${JSON.stringify(publicProvisioningSummary(plan), null, 2)}\n`,
    'utf8'
  );
}

console.log(JSON.stringify(publicProvisioningSummary(plan), null, 2));
