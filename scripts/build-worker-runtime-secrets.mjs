import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLATFORM_BINDINGS = [
  'CLOUDFLARE_PLATFORM_ACCOUNT_ID',
  'CLOUDFLARE_PLATFORM_API_TOKEN'
];

export const PORTAL_AUTH_RUNTIME_BINDINGS = [
  'ADMIN_AUTH_ISSUER',
  'ADMIN_AUTH_AUDIENCE',
  'ADMIN_AUTH_JWKS_URL',
  'PORTAL_AUTH_CLIENT_ID'
];

function clean(value) {
  return String(value || '').trim();
}

function requireBinding(env, name) {
  const value = clean(env?.[name]);
  if (!value) throw new Error(`runtime_binding_missing:${name}`);
  return value;
}

export function buildWorkerRuntimeSecrets(env = {}) {
  const secrets = Object.fromEntries(
    PLATFORM_BINDINGS.map((name) => [name, requireBinding(env, name)])
  );

  const portalAuthValues = Object.fromEntries(
    PORTAL_AUTH_RUNTIME_BINDINGS.map((name) => [name, clean(env?.[name])])
  );
  const presentPortalAuthBindings = PORTAL_AUTH_RUNTIME_BINDINGS.filter(
    (name) => portalAuthValues[name]
  );

  if (
    presentPortalAuthBindings.length !== 0 &&
    presentPortalAuthBindings.length !== PORTAL_AUTH_RUNTIME_BINDINGS.length
  ) {
    throw new Error('portal_auth_runtime_config_partial');
  }

  const portalAuthConfigured =
    presentPortalAuthBindings.length === PORTAL_AUTH_RUNTIME_BINDINGS.length;
  if (portalAuthConfigured) Object.assign(secrets, portalAuthValues);

  return {
    secrets,
    portalAuthConfigured,
    bindingNames: Object.keys(secrets).sort()
  };
}

async function main() {
  const outputPath = clean(process.argv[2]);
  if (!outputPath) throw new Error('runtime_secrets_output_path_missing');

  const result = buildWorkerRuntimeSecrets(process.env);
  await writeFile(outputPath, `${JSON.stringify(result.secrets)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);

  console.log(
    JSON.stringify({
      runtimeSecretsPrepared: true,
      portalAuthConfigured: result.portalAuthConfigured,
      bindingNames: result.bindingNames,
      secretValuesExposed: false
    })
  );
}

const isDirectExecution =
  Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
