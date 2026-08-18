import { describe, expect, it } from 'vitest';
import { resolveStorefrontTenant } from '../worker/tenant-routing.js';

function fakeDb(row) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            }
          };
        }
      };
    }
  };
}

function request(hostname, path = '/') {
  return new Request(`https://${hostname}${path}`);
}

describe('merchant hostname dispatch routing', () => {
  it('allows a non-default tenant only after the full isolated runtime is verified', async () => {
    const env = {
      CATALOG_DB: fakeDb({
        tenant_id: 't_aaaaaaaaaaaaaaaaaaaa',
        domain_status: 'active',
        data_plane_key: 'dp-tenant-a',
        data_plane_status: 'ready',
        setup_status: 'published',
        worker_script_name: 'ce-aaaaaaaaaaaaaaaaaaaa',
        worker_status: 'active',
        runtime_kind: 'catalog',
        runtime_status: 'verified',
        runtime_version: 1
      })
    };
    const result = await resolveStorefrontTenant(request('shop.example.com'), env);
    expect(result).toMatchObject({
      allowed: true,
      mode: 'dispatch',
      tenantId: 't_aaaaaaaaaaaaaaaaaaaa',
      dispatchScriptName: 'ce-aaaaaaaaaaaaaaaaaaaa',
      runtimeVersion: 1
    });
  });

  it('never falls through to tenant #0001 when a merchant runtime is unverified', async () => {
    const env = {
      CATALOG_DB: fakeDb({
        tenant_id: 't_bbbbbbbbbbbbbbbbbbbb',
        domain_status: 'active',
        data_plane_key: 'dp-tenant-b',
        data_plane_status: 'ready',
        setup_status: 'published',
        worker_script_name: 'ce-bbbbbbbbbbbbbbbbbbbb',
        worker_status: 'active',
        runtime_kind: 'catalog',
        runtime_status: 'staged',
        runtime_version: 1
      })
    };
    const result = await resolveStorefrontTenant(request('shop-b.example.com'), env);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(503);
    expect(result.reason).toBe('tenant_runtime_not_ready');
    expect(result.tenantId).toBeUndefined();
  });
});
