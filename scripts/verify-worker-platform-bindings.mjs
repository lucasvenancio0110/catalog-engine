import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_BINDINGS = ['CLOUDFLARE_PLATFORM_ACCOUNT_ID', 'CLOUDFLARE_PLATFORM_API_TOKEN'];
const PORTAL_AUTH_BINDINGS = [
  'ADMIN_AUTH_ISSUER',
  'ADMIN_AUTH_AUDIENCE',
  'ADMIN_AUTH_JWKS_URL',
  'PORTAL_AUTH_CLIENT_ID'
];

export function inspectWorkerPlatformBindings(payload) {
  if (payload?.success !== true || !Array.isArray(payload?.result?.bindings)) {
    throw new Error('worker_platform_settings_invalid');
  }
  const allNames = new Set(
    payload.result.bindings.map((binding) => String(binding?.name || '')).filter(Boolean)
  );
  const secretNames = new Set(
    payload.result.bindings
      .filter((binding) => binding?.type === 'secret_text')
      .map((binding) => String(binding?.name || ''))
  );
  const bindings = {
    accountIdPresent: secretNames.has(REQUIRED_BINDINGS[0]),
    apiTokenPresent: secretNames.has(REQUIRED_BINDINGS[1]),
    imagesPresent: allNames.has('IMAGES'),
    brandAssetsR2Present: allNames.has('BRAND_ASSETS')
  };
  const portalAuthBindings = Object.fromEntries(
    PORTAL_AUTH_BINDINGS.map((name) => [name, secretNames.has(name)])
  );
  const portalAuthBindingCount = Object.values(portalAuthBindings).filter(Boolean).length;
  return {
    workerPlatformBindingsVerified: bindings.accountIdPresent && bindings.apiTokenPresent,
    bindings,
    portalAuth: {
      configured: portalAuthBindingCount === PORTAL_AUTH_BINDINGS.length,
      bindingCount: portalAuthBindingCount,
      bindings: portalAuthBindings
    },
    secretValuesExposed: false
  };
}

async function main() {
  const settingsPath = String(process.argv[2] || '').trim();
  if (!settingsPath) throw new Error('worker_platform_settings_path_missing');
  const payload = JSON.parse(await readFile(settingsPath, 'utf8'));
  const evidence = inspectWorkerPlatformBindings(payload);
  console.log(JSON.stringify(evidence));
  if (process.argv.includes('--require') && !evidence.workerPlatformBindingsVerified) {
    throw new Error('worker_platform_bindings_missing');
  }
  if (process.argv.includes('--require-images') && !evidence.bindings.imagesPresent) {
    throw new Error('worker_images_binding_missing');
  }
  if (process.argv.includes('--require-brand-assets') && !evidence.bindings.brandAssetsR2Present) {
    throw new Error('worker_brand_assets_r2_binding_missing');
  }
  if (process.argv.includes('--require-portal-auth') && !evidence.portalAuth.configured) {
    throw new Error('portal_auth_bindings_missing');
  }
  if (process.argv.includes('--forbid-portal-auth') && evidence.portalAuth.bindingCount !== 0) {
    throw new Error('portal_auth_bindings_unexpected');
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
