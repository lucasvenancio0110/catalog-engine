import { describe, expect, it, vi } from 'vitest';
import {
  CloudflareSaasError,
  cloudflareCustomHostnameState,
  createCloudflareCustomHostname,
  getCloudflareCustomHostname,
  restartCloudflareHttpDcv
} from '../worker/cloudflare-saas.js';
import { buildTenantDomainAttachPlan, publicTenantDomainState } from '../worker/custom-domain.js';
import { buildTenantCustomDomain } from '../src/domain/tenant-domain.js';

const tenantId = 't_0123456789abcdefabcd';
const zoneId = '0123456789abcdef0123456789abcdef';
const apiToken = 'test-token-that-is-long-enough-for-validation';
const cnameTarget = 'shops.catalogengine.com.br';

function providerResult(overrides = {}) {
  return {
    id: 'abcd1234abcd1234abcd1234abcd1234',
    hostname: 'www.lojaarena.com.br',
    status: 'pending',
    ownership_verification: {
      type: 'txt',
      name: '_cf-custom-hostname.www.lojaarena.com.br',
      value: 'ownership-token'
    },
    ssl: {
      status: 'pending_validation',
      validation_records: [
        {
          txt_name: '_acme-challenge.www.lojaarena.com.br',
          txt_value: 'ssl-token',
          http_url: 'http://www.lojaarena.com.br/.well-known/pki-validation/token.txt',
          http_body: 'http-token'
        }
      ]
    },
    ...overrides
  };
}

function cloudflareResponse(result = providerResult(), status = 201) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('customer custom domains', () => {
  it('uses the same deterministic domain identity as the existing Node domain planner', async () => {
    const workerPlan = await buildTenantDomainAttachPlan({
      tenantId,
      hostname: 'WWW.LojaArena.COM.BR.'
    });
    const nodeDomain = buildTenantCustomDomain({
      tenantId,
      hostname: 'www.lojaarena.com.br'
    });

    expect(workerPlan.domain).toEqual(nodeDomain);
    expect(workerPlan.job.jobId).toMatch(/^djob_[a-f0-9]{20}$/);
    expect(workerPlan.domain.domainType).toBe('custom');
  });

  it('publishes only customer-actionable DNS validation fields and requires all active states', () => {
    const pending = publicTenantDomainState({
      domain_id: 'dom_0123456789abcdefabcd',
      hostname: 'www.lojaarena.com.br',
      domain_status: 'verifying',
      provider: 'cloudflare',
      provider_status: 'pending',
      ssl_status: 'pending_validation',
      cname_target: cnameTarget,
      ownership_txt_name: '_cf-custom-hostname.www.lojaarena.com.br',
      ownership_txt_value: 'ownership-token',
      ssl_txt_name: '_acme-challenge.www.lojaarena.com.br',
      ssl_txt_value: 'ssl-token',
      ssl_http_url: null,
      ssl_http_body: null
    });

    expect(pending.readyForPublish).toBe(false);
    expect(pending.dns.records).toEqual([
      { type: 'CNAME', name: 'www.lojaarena.com.br', value: cnameTarget },
      {
        type: 'TXT',
        name: '_cf-custom-hostname.www.lojaarena.com.br',
        value: 'ownership-token'
      },
      { type: 'TXT', name: '_acme-challenge.www.lojaarena.com.br', value: 'ssl-token' }
    ]);

    const active = publicTenantDomainState({
      ...{
        domain_id: 'dom_0123456789abcdefabcd',
        hostname: 'www.lojaarena.com.br',
        provider: 'cloudflare',
        cname_target: cnameTarget
      },
      domain_status: 'active',
      provider_status: 'active',
      ssl_status: 'active'
    });
    expect(active.readyForPublish).toBe(true);
  });

  it('creates a Cloudflare custom hostname with HTTP DV and minimum TLS 1.2', async () => {
    const fetchImpl = vi.fn(async () => cloudflareResponse());
    const state = await createCloudflareCustomHostname(
      {
        zoneId,
        apiToken,
        hostname: 'www.lojaarena.com.br',
        cnameTarget
      },
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`);
    expect(options.method).toBe('POST');
    expect(options.redirect).toBe('error');
    expect(options.headers.authorization).toBe(`Bearer ${apiToken}`);
    expect(JSON.parse(options.body)).toMatchObject({
      hostname: 'www.lojaarena.com.br',
      ssl: {
        method: 'http',
        type: 'dv',
        wildcard: false,
        settings: { min_tls_version: '1.2' }
      }
    });
    expect(state).toMatchObject({
      provider: 'cloudflare',
      providerStatus: 'pending',
      sslStatus: 'pending_validation',
      cnameTarget,
      ready: false
    });
    expect(state.ownershipTxtValue).toBe('ownership-token');
    expect(state.sslTxtValue).toBe('ssl-token');
  });

  it('treats the hostname as provider-ready only when hostname and SSL are both active', () => {
    expect(
      cloudflareCustomHostnameState(providerResult({ status: 'active', ssl: { status: 'pending' } }))
        .ready
    ).toBe(false);
    expect(
      cloudflareCustomHostnameState(providerResult({ status: 'active', ssl: { status: 'active' } }))
        .ready
    ).toBe(true);
  });

  it('reads and restarts HTTP DCV through the documented custom-hostname resource', async () => {
    const fetchImpl = vi.fn(async (_url, options) =>
      cloudflareResponse(providerResult({ status: 'active', ssl: { status: 'active' } }), options.method === 'PATCH' ? 202 : 200)
    );
    const args = {
      zoneId,
      apiToken,
      providerHostnameId: 'abcd1234abcd1234abcd1234abcd1234',
      cnameTarget
    };

    const read = await getCloudflareCustomHostname(args, { fetchImpl });
    const restarted = await restartCloudflareHttpDcv(args, { fetchImpl });

    expect(read.ready).toBe(true);
    expect(restarted.ready).toBe(true);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(fetchImpl.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      ssl: { method: 'http', type: 'dv' }
    });
  });

  it('maps Cloudflare failures to stable error codes without echoing provider messages or secrets', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ code: 1407, message: `do not leak ${apiToken}` }]
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );

    await expect(
      createCloudflareCustomHostname(
        { zoneId, apiToken, hostname: 'www.lojaarena.com.br', cnameTarget },
        { fetchImpl }
      )
    ).rejects.toMatchObject({
      name: 'CloudflareSaasError',
      code: 'cloudflare_custom_hostname_1407',
      status: 422
    });
  });

  it('fails closed before network access when Cloudflare for SaaS runtime config is absent', async () => {
    const fetchImpl = vi.fn();
    await expect(
      createCloudflareCustomHostname(
        { zoneId: '', apiToken: '', hostname: 'www.lojaarena.com.br' },
        { fetchImpl }
      )
    ).rejects.toBeInstanceOf(CloudflareSaasError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
