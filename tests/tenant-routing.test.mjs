import { describe, expect, it, vi } from 'vitest';
import workerEntry from '../worker/entry.js';
import {
  isCatalogAdminHost,
  isCatalogPlatformHost,
  resolveStorefrontTenant
} from '../worker/tenant-routing.js';

const platformEnv = {
  CATALOG_PLATFORM_HOSTS:
    'catalog-engine.lucassantanals0110.workers.dev,catalogoengine.com,app.catalogoengine.com',
  CATALOG_ADMIN_HOST: 'app.catalogoengine.com'
};

function fakeDb(row) {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { db: { prepare }, prepare, bind, first };
}

describe('public tenant hostname routing', () => {
  it('keeps the current first-party Worker hostname available as private/platform preview', async () => {
    const request = new Request('https://catalog-engine.lucassantanals0110.workers.dev/api/products');
    expect(isCatalogPlatformHost(request, platformEnv)).toBe(true);

    const result = await resolveStorefrontTenant(request, platformEnv);
    expect(result).toMatchObject({
      allowed: true,
      mode: 'platform_preview',
      tenantId: 't_00000000000000000001',
      dataPlaneKey: 'catalog-engine-default'
    });
  });

  it('recognizes app.catalogoengine.com as the dedicated customer portal host', () => {
    expect(
      isCatalogAdminHost(new Request('https://app.catalogoengine.com/'), platformEnv)
    ).toBe(true);
    expect(
      isCatalogAdminHost(new Request('https://catalogoengine.com/'), platformEnv)
    ).toBe(false);
  });

  it('serves the customer portal shell instead of tenant #0001 storefront on the app host', async () => {
    const assetsFetch = vi.fn(async (request) => new Response(new URL(request.url).pathname));
    const response = await workerEntry.fetch(
      new Request('https://app.catalogoengine.com/lojas'),
      { ...platformEnv, ASSETS: { fetch: assetsFetch } },
      { waitUntil: vi.fn() }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/app.html');
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('allows an active published custom hostname only when it resolves to the attached current data plane', async () => {
    const { db } = fakeDb({
      tenant_id: 't_00000000000000000001',
      domain_status: 'active',
      data_plane_key: 'catalog-engine-default',
      data_plane_status: 'ready',
      setup_status: 'published'
    });
    const result = await resolveStorefrontTenant(
      new Request('https://www.lojaarena.com.br/'),
      { ...platformEnv, CATALOG_DB: db }
    );

    expect(result).toMatchObject({
      allowed: true,
      mode: 'custom_domain',
      hostname: 'www.lojaarena.com.br',
      tenantId: 't_00000000000000000001'
    });
  });

  it('never falls a future tenant through to tenant #0001 catalog data', async () => {
    const { db } = fakeDb({
      tenant_id: 't_aaaaaaaaaaaaaaaaaaaa',
      domain_status: 'active',
      data_plane_key: 'dp_aaaaaaaaaaaaaaaaaaaa',
      data_plane_status: 'ready',
      setup_status: 'published'
    });
    const result = await resolveStorefrontTenant(
      new Request('https://cliente.example.com/api/products'),
      { ...platformEnv, CATALOG_DB: db }
    );

    expect(result).toEqual({
      allowed: false,
      reason: 'tenant_data_plane_not_attached',
      status: 503
    });
  });

  it('does not serve a verified domain before the merchant publish checkpoint is complete', async () => {
    const { db } = fakeDb({
      tenant_id: 't_00000000000000000001',
      domain_status: 'active',
      data_plane_key: 'catalog-engine-default',
      data_plane_status: 'ready',
      setup_status: 'ready'
    });
    const result = await resolveStorefrontTenant(
      new Request('https://www.lojaarena.com.br/'),
      { ...platformEnv, CATALOG_DB: db }
    );

    expect(result).toEqual({ allowed: false, reason: 'storefront_not_published', status: 404 });
  });

  it('returns not found for unknown customer hostnames instead of serving the default store', async () => {
    const { db } = fakeDb(null);
    const result = await resolveStorefrontTenant(
      new Request('https://unknown-customer.example.com/'),
      { ...platformEnv, CATALOG_DB: db }
    );
    expect(result).toEqual({ allowed: false, reason: 'storefront_not_found', status: 404 });
  });

  it('does not expose admin endpoints on merchant storefront hostnames', async () => {
    const response = await workerEntry.fetch(
      new Request('https://merchant.example.com/api/admin/session'),
      { ...platformEnv },
      { waitUntil: vi.fn() }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('does not expose the portal html entry on merchant storefront domains', async () => {
    const response = await workerEntry.fetch(
      new Request('https://merchant.example.com/app.html'),
      { ...platformEnv },
      { waitUntil: vi.fn() }
    );
    expect(response.status).toBe(404);
  });
});
