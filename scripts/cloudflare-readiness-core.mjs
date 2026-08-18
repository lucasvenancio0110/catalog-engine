import { readFile } from 'node:fs/promises';
import { assertDispatchNamespace } from '../worker/cloudflare-platform.js';

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function nonEmpty(value) {
  return String(value || '').trim();
}

export function cloudflareActivationConfig(env = process.env) {
  const platform = {
    accountId: nonEmpty(env.CLOUDFLARE_PLATFORM_ACCOUNT_ID),
    apiToken: nonEmpty(env.CLOUDFLARE_PLATFORM_API_TOKEN),
    dispatchNamespace: nonEmpty(env.CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE)
  };
  const saas = {
    zoneId: nonEmpty(env.CLOUDFLARE_SAAS_ZONE_ID),
    apiToken: nonEmpty(env.CLOUDFLARE_SAAS_API_TOKEN),
    cnameTarget: nonEmpty(env.CLOUDFLARE_SAAS_CNAME_TARGET).toLowerCase().replace(/\.$/, '')
  };
  return { platform, saas };
}

export function validateActivationConfig(config) {
  const findings = [];
  if (!/^[a-f0-9]{32}$/i.test(config.platform.accountId)) findings.push('platform_account_id_missing');
  if (config.platform.apiToken.length < 20) findings.push('platform_api_token_missing');
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(config.platform.dispatchNamespace)) {
    findings.push('platform_dispatch_namespace_missing');
  }
  if (!/^[a-f0-9]{32}$/i.test(config.saas.zoneId)) findings.push('saas_zone_id_missing');
  if (config.saas.apiToken.length < 20) findings.push('saas_api_token_missing');
  if (!HOSTNAME_PATTERN.test(config.saas.cnameTarget)) findings.push('saas_cname_target_missing');
  return findings;
}

export async function inspectWranglerActivationBoundary(path = 'wrangler.jsonc') {
  const text = await readFile(path, 'utf8');
  return {
    usesPublishEntry: /"main"\s*:\s*"\.\/worker\/entry-publish\.js"/.test(text),
    dispatchBindingCommitted: /TENANT_DISPATCH|dispatch_namespace/i.test(text)
  };
}

export async function checkCloudflareActivationReadiness(
  { env = process.env, wranglerPath = 'wrangler.jsonc' } = {},
  { fetchImpl = fetch } = {}
) {
  const config = cloudflareActivationConfig(env);
  const findings = validateActivationConfig(config);
  const repo = await inspectWranglerActivationBoundary(wranglerPath);

  if (!repo.usesPublishEntry) findings.push('publish_entry_not_active');
  if (repo.dispatchBindingCommitted) findings.push('dispatch_binding_already_committed');

  let namespaceReachable = false;
  if (!findings.some((code) => code.startsWith('platform_'))) {
    try {
      await assertDispatchNamespace(config.platform, { fetchImpl });
      namespaceReachable = true;
    } catch {
      findings.push('platform_dispatch_namespace_unreachable');
    }
  }

  return {
    readyForControlledActivation: findings.length === 0 && namespaceReachable,
    namespaceReachable,
    repositoryBoundarySafe: repo.usesPublishEntry && !repo.dispatchBindingCommitted,
    customDomainRuntimeConfigured: !findings.some((code) => code.startsWith('saas_')),
    findings: [...new Set(findings)]
  };
}
