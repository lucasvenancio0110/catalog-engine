import { describe, expect, it } from 'vitest';
import {
  buildTenantSourceConnection,
  normalizeYupooCatalogUrl,
  publicTenantSourceSummary
} from '../src/domain/tenant-source-connection.js';
import { buildTenantSourceConnectionSql } from '../scripts/tenant-source-connection-core.mjs';
import { verifyYupooSourceUrl } from '../scripts/yupoo-source-resolver.mjs';

const tenantId = 't_00000000000000000001';

function response(status, url = '') {
  return {
    status,
    url,
    body: { cancel: async () => {} }
  };
}

describe('tenant supplier connections', () => {
  it('normalizes a Yupoo root into the catalog albums route and removes navigation noise', () => {
    expect(normalizeYupooCatalogUrl('https://supplier.x.yupoo.com/?page=2#ignored')).toEqual({
      canonicalUrl: 'https://supplier.x.yupoo.com/albums/',
      scopeKind: 'catalog'
    });
  });

  it('preserves only the Yupoo subcategory routing flag for category sources', () => {
    expect(
      normalizeYupooCatalogUrl(
        'https://supplier.x.yupoo.com/categories/66243?uid=1&isSubCate=true&page=4'
      )
    ).toEqual({
      canonicalUrl: 'https://supplier.x.yupoo.com/categories/66243?isSubCate=true',
      scopeKind: 'category'
    });
  });

  it('rejects detail albums, insecure URLs and lookalike hosts', () => {
    expect(() => normalizeYupooCatalogUrl('https://supplier.x.yupoo.com/albums/123')).toThrow();
    expect(() => normalizeYupooCatalogUrl('http://supplier.x.yupoo.com/albums/')).toThrow();
    expect(() => normalizeYupooCatalogUrl('https://supplier.x.yupoo.com.evil.example/albums/')).toThrow();
  });

  it('keeps one stable connection slot while rotating the private locator when the source changes', () => {
    const first = buildTenantSourceConnection({
      tenantId,
      sourceUrl: 'https://supplier.x.yupoo.com/albums/'
    });
    const retry = buildTenantSourceConnection({
      tenantId,
      sourceUrl: 'https://supplier.x.yupoo.com/albums/?page=9'
    });
    const replacement = buildTenantSourceConnection({
      tenantId,
      sourceUrl: 'https://other-supplier.x.yupoo.com/albums/'
    });

    expect(retry.connection.connectionId).toBe(first.connection.connectionId);
    expect(retry.connection.sourceLocatorRef).toBe(first.connection.sourceLocatorRef);
    expect(replacement.connection.connectionId).toBe(first.connection.connectionId);
    expect(replacement.connection.sourceLocatorRef).not.toBe(first.connection.sourceLocatorRef);
  });

  it('returns a public connection summary without supplier URLs or locator references', () => {
    const plan = buildTenantSourceConnection({
      tenantId,
      sourceUrl: 'https://supplier.x.yupoo.com/albums/'
    });
    const summary = publicTenantSourceSummary(plan);
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({ provider: 'yupoo', sourceKey: 'primary', status: 'active' });
    expect(serialized).not.toContain('supplier.x.yupoo.com');
    expect(serialized).not.toContain('sourceLocatorRef');
    expect(serialized).not.toContain('canonicalUrl');
  });

  it('verifies the provider route with a bounded network adapter', async () => {
    const calls = [];
    const resolved = await verifyYupooSourceUrl('https://supplier.x.yupoo.com/albums/', {
      fetchImpl: async (url) => {
        calls.push(url);
        return response(200, url);
      }
    });

    expect(resolved).toBe('https://supplier.x.yupoo.com/albums/');
    expect(calls).toEqual(['https://supplier.x.yupoo.com/albums/']);
  });

  it('builds idempotent private persistence SQL and advances only the matching provisioning run', () => {
    const plan = buildTenantSourceConnection({
      tenantId,
      sourceUrl: 'https://supplier.x.yupoo.com/albums/'
    });
    const sql = buildTenantSourceConnectionSql(plan, { provisioningId: 'pv_0123456789abcdefabcd' });

    expect(sql).toContain('supplier_sources');
    expect(sql).toContain('tenant_source_connections');
    expect(sql).toContain('ON CONFLICT(tenant_id, source_key)');
    expect(sql).toContain("step_key='source'");
    expect(sql).toContain(tenantId);
    expect(sql).toContain('https://supplier.x.yupoo.com/albums/');
  });
});
