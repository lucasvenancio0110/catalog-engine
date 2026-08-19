import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  CATALOGOENGINE_DISPATCH_NAMESPACE,
  CATALOGOENGINE_SAAS_CNAME_TARGET,
  checkCloudflareActivationReadiness,
  cloudflareActivationConfig,
  validateActivationConfig
} from '../scripts/cloudflare-readiness-core.mjs';

const validEnv = {
  CLOUDFLARE_PLATFORM_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token-that-is-long-enough-for-tests',
  CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: CATALOGOENGINE_DISPATCH_NAMESPACE,
  CLOUDFLARE_SAAS_ZONE_ID: 'fedcba9876543210fedcba9876543210',
  CLOUDFLARE_SAAS_API_TOKEN: 'saas-token-that-is-long-enough-for-tests',
  CLOUDFLARE_SAAS_CNAME_TARGET: CATALOGOENGINE_SAAS_CNAME_TARGET
};

function success(result) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Cloudflare activation readiness', () => {
  it('reports missing dedicated runtime config with stable safe codes', () => {
    const config = cloudflareActivationConfig({});
    expect(validateActivationConfig(config)).toEqual(
      expect.arrayContaining([
        'platform_account_id_missing',
        'platform_api_token_missing',
        'platform_dispatch_namespace_missing',
        'saas_zone_id_missing',
        'saas_api_token_missing',
        'saas_cname_target_missing'
      ])
    );
  });

  it('rejects a valid-looking SaaS target that is not the production edge hostname', () => {
    const config = cloudflareActivationConfig({
      ...validEnv,
      CLOUDFLARE_SAAS_CNAME_TARGET: 'shops.catalogoengine.com'
    });
    expect(validateActivationConfig(config)).toContain('saas_cname_target_mismatch');
  });

  it('becomes activation-ready only when provider namespace is reachable and repo boundary remains inert', async () => {
    const path = '/tmp/catalog-engine-readiness-wrangler.jsonc';
    await writeFile(
      path,
      JSON.stringify({ name: 'catalog-engine', main: './worker/entry-publish.js' }),
      'utf8'
    );
    const fetchImpl = vi.fn(async () =>
      success({ namespace_name: CATALOGOENGINE_DISPATCH_NAMESPACE, namespace_id: 'namespace-id' })
    );
    const result = await checkCloudflareActivationReadiness(
      { env: validEnv, wranglerPath: path },
      { fetchImpl }
    );
    expect(result).toEqual({
      readyForControlledActivation: true,
      namespaceReachable: true,
      repositoryBoundarySafe: true,
      customDomainRuntimeConfigured: true,
      expectedSaasCnameTarget: CATALOGOENGINE_SAAS_CNAME_TARGET,
      recommendedDispatchNamespace: CATALOGOENGINE_DISPATCH_NAMESPACE,
      findings: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses readiness if a dispatch binding appears in the committed wrangler config', async () => {
    const path = '/tmp/catalog-engine-readiness-wrangler-bound.jsonc';
    await writeFile(
      path,
      JSON.stringify({
        main: './worker/entry-publish.js',
        dispatch_namespace: { binding: 'TENANT_DISPATCH' }
      }),
      'utf8'
    );
    const fetchImpl = vi.fn(async () =>
      success({ namespace_name: CATALOGOENGINE_DISPATCH_NAMESPACE, namespace_id: 'namespace-id' })
    );
    const result = await checkCloudflareActivationReadiness(
      { env: validEnv, wranglerPath: path },
      { fetchImpl }
    );
    expect(result.readyForControlledActivation).toBe(false);
    expect(result.repositoryBoundarySafe).toBe(false);
    expect(result.findings).toContain('dispatch_binding_already_committed');
  });

  it('does not leak provider messages or secrets when namespace access fails', async () => {
    const path = '/tmp/catalog-engine-readiness-wrangler-fail.jsonc';
    await writeFile(path, JSON.stringify({ main: './worker/entry-publish.js' }), 'utf8');
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ code: 10090, message: validEnv.CLOUDFLARE_PLATFORM_API_TOKEN }]
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      );
    const result = await checkCloudflareActivationReadiness(
      { env: validEnv, wranglerPath: path },
      { fetchImpl }
    );
    expect(result.findings).toContain('platform_dispatch_namespace_unreachable');
    expect(JSON.stringify(result)).not.toContain(validEnv.CLOUDFLARE_PLATFORM_API_TOKEN);
  });
});
