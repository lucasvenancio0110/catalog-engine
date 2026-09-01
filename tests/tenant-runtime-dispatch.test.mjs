import { describe, expect, it, vi } from 'vitest';
import {
  tenantCatalogRuntime,
  tenantCatalogWorkerSource,
  TENANT_CATALOG_RUNTIME_VERSION
} from '../worker/tenant-catalog-runtime.js';
import {
  dispatchTenantRequest,
  smokeTenantRuntime,
  tenantDispatchConfigured
} from '../worker/tenant-dispatch.js';

const tenantA = 't_aaaaaaaaaaaaaaaaaaaa';
const tenantB = 't_bbbbbbbbbbbbbbbbbbbb';
const productA = 'p_aaaaaaaaaaaaaaaaaaaa';
const productB = 'p_bbbbbbbbbbbbbbbbbbbb';
const mediaA = 'm_aaaaaaaaaaaaaaaaaaaa';
const mediaB = 'm_bbbbbbbbbbbbbbbbbbbb';

function productRow(id, mediaId, name) {
  return {
    product_id: id,
    name,
    display_name: name,
    category_id: 'c_aaaaaaaaaaaaaaaaaaaa',
    category_name: 'Camisas',
    display_category_name: 'Camisas',
    description: '',
    team_id: null,
    league_id: null,
    image_count: 1,
    primary_media_id: mediaId,
    sort_order: 0
  };
}

function fakeTenantD1(tenantId, product, mediaId, storeName) {
  const meta = [
    { key: 'store', value_json: JSON.stringify({ name: storeName }) },
    { key: 'stats', value_json: JSON.stringify({ products: 1 }) },
    { key: 'storage', value_json: JSON.stringify({ mode: 'edge-proxy' }) },
    { key: 'normalization', value_json: JSON.stringify({ version: 1 }) }
  ];
  return {
    prepare(sql) {
      const state = { params: [] };
      const statement = {
        bind(...params) {
          state.params = params;
          return statement;
        },
        async first() {
          if (sql.includes('FROM data_plane_identity')) {
            return { tenant_id: tenantId, schema_version: 3 };
          }
          if (sql.includes('FROM catalog_products p') && sql.includes('WHERE p.product_id')) {
            return state.params[0] === product.product_id ? product : null;
          }
          if (sql.includes('COUNT(*) AS total FROM catalog_products')) return { total: 1 };
          if (sql.includes('FROM media_sources WHERE media_id')) {
            return state.params[0] === mediaId
              ? {
                  source_url: `https://photo.yupoo.com/private/${mediaId}/full.jpg`,
                  display_source_url: null,
                  thumbnail_source_url: null,
                  referer_url: 'https://private.x.yupoo.com/albums/1'
                }
              : null;
          }
          return null;
        },
        async all() {
          if (sql.includes('SELECT key, value_json FROM catalog_meta')) return { results: meta };
          if (sql.includes('FROM product_media WHERE product_id')) {
            return {
              results: state.params[0] === product.product_id ? [{ media_id: mediaId }] : []
            };
          }
          return { results: [] };
        }
      };
      return statement;
    }
  };
}

function tenantFetcher(tenantId, product, mediaId, storeName) {
  const env = {
    TENANT_ID: tenantId,
    CATALOG_DB: fakeTenantD1(tenantId, product, mediaId, storeName)
  };
  return {
    fetch(request) {
      return tenantCatalogRuntime.fetch(request, env, { waitUntil() {} });
    }
  };
}

describe('isolated tenant runtime and dispatch boundary', () => {
  it('generates a self-contained catalog runtime with no admin/control-plane endpoint', () => {
    const source = tenantCatalogWorkerSource();
    expect(TENANT_CATALOG_RUNTIME_VERSION).toBe(1);
    expect(source).toContain('/api/catalog/meta');
    expect(source).toContain('/api/products');
    expect(source).toContain('/media/');
    expect(source).not.toContain('/api/admin/');
    expect(source).not.toContain('tenant_memberships');
    expect(source).not.toContain('tenant_domains');
    expect(source).toContain("['name-asc', 'name-desc']");
    expect(source).toContain('COLLATE NOCASE ASC');
  });

  it('keeps two tenant D1 databases isolated even when product ids are probed cross-tenant', async () => {
    const fetcherA = tenantFetcher(
      tenantA,
      productRow(productA, mediaA, 'Produto A'),
      mediaA,
      'Loja A'
    );
    const fetcherB = tenantFetcher(
      tenantB,
      productRow(productB, mediaB, 'Produto B'),
      mediaB,
      'Loja B'
    );

    const ownA = await fetcherA.fetch(new Request(`https://a.example/api/products/${productA}`));
    const crossA = await fetcherA.fetch(new Request(`https://a.example/api/products/${productB}`));
    const ownB = await fetcherB.fetch(new Request(`https://b.example/api/products/${productB}`));
    const crossB = await fetcherB.fetch(new Request(`https://b.example/api/products/${productA}`));

    expect(ownA.status).toBe(200);
    expect((await ownA.json()).product.name).toBe('Produto A');
    expect(crossA.status).toBe(404);
    expect(ownB.status).toBe(200);
    expect((await ownB.json()).product.name).toBe('Produto B');
    expect(crossB.status).toBe(404);
  });

  it('dispatches only to the explicitly selected tenant script', async () => {
    const fetcherA = tenantFetcher(
      tenantA,
      productRow(productA, mediaA, 'Produto A'),
      mediaA,
      'Loja A'
    );
    const fetcherB = tenantFetcher(
      tenantB,
      productRow(productB, mediaB, 'Produto B'),
      mediaB,
      'Loja B'
    );
    const get = vi.fn((script) => ({ 'ce-a': fetcherA, 'ce-b': fetcherB })[script]);
    const env = { TENANT_DISPATCH: { get } };
    expect(tenantDispatchConfigured(env)).toBe(true);

    const response = await dispatchTenantRequest(
      new Request(`https://merchant.example/api/products/${productA}`),
      env,
      'ce-a'
    );
    expect(response.status).toBe(200);
    expect((await response.json()).product.name).toBe('Produto A');
    expect(get).toHaveBeenCalledWith('ce-a');
    expect(get).not.toHaveBeenCalledWith('ce-b');
  });

  it('smoke checks the selected runtime and requires a non-empty catalog', async () => {
    const fetcherA = tenantFetcher(
      tenantA,
      productRow(productA, mediaA, 'Produto A'),
      mediaA,
      'Loja A'
    );
    const env = { TENANT_DISPATCH: { get: () => fetcherA } };
    const result = await smokeTenantRuntime(env, 'ce-a', 1);
    expect(result).toEqual({ runtimeVersion: 1, schemaVersion: 3, products: 1 });
  });
});
