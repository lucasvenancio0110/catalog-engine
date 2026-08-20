import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  CatalogProviderError,
  assertCatalogProviderDetailResult,
  assertCatalogProviderScanResult,
  createCatalogProviderRegistry,
  defineCatalogProvider
} from '../src/catalog-provider/provider-contract.js';
import { resolveCatalogSource } from '../src/catalog-provider/index.js';
import { sha256Hex } from '../worker/runtime-identity.js';
import { resolveCatalogIngestionProvider } from '../worker/ingestion/providers/index.js';

const yupooRoot = 'https://supplier.x.yupoo.com/albums/';

describe('CatalogProvider contract', () => {
  it('auto-detects and normalizes Yupoo without exposing provider rules to tenant source core', () => {
    const resolved = resolveCatalogSource({
      sourceUrl: 'https://supplier.x.yupoo.com/?page=9#ignored'
    });
    expect(resolved.provider.key).toBe('yupoo');
    expect(resolved.normalized).toEqual({
      canonicalUrl: yupooRoot,
      scopeKind: 'catalog'
    });
  });

  it('keeps provider lookup fail-closed for unsupported sources and keys', () => {
    expect(() => resolveCatalogSource({ sourceUrl: 'https://example.com/catalog' })).toThrow(
      CatalogProviderError
    );
    try {
      resolveCatalogSource({ provider: 'unknown-provider', sourceUrl: 'https://example.com/' });
      throw new Error('expected provider rejection');
    } catch (error) {
      expect(error.code).toBe('catalog_source_provider_not_supported');
    }
  });

  it('supports a second provider contract without changing registry/core code', () => {
    const mock = defineCatalogProvider({
      key: 'mock',
      canHandleSource: (value) => String(value).startsWith('https://mock.example/'),
      normalizeSource: (value) => ({ canonicalUrl: new URL(value).href, scopeKind: 'catalog' })
    });
    const registry = createCatalogProviderRegistry([mock]);
    expect(registry.detectSource('https://mock.example/catalog').key).toBe('mock');
    expect(registry.get('mock', ['normalizeSource']).normalizeSource('https://mock.example/catalog'))
      .toMatchObject({ scopeKind: 'catalog' });
  });

  it('preserves existing Yupoo category and media opaque identity seeds', async () => {
    const provider = resolveCatalogIngestionProvider('yupoo');
    const categoryDigest = await sha256Hex('catalog-engine:public-id:v1|yupoo|123');
    expect(await provider.publicCategoryId('123')).toBe(`c_${categoryDigest.slice(0, 20)}`);

    const mediaUrl = 'https://photo.yupoo.com/supplier/group/full.jpg';
    const mediaDigest = await sha256Hex(`catalog-engine:remote-media:v1|yupoo|${mediaUrl}`);
    expect(await provider.mediaId(mediaUrl)).toBe(`m_${mediaDigest.slice(0, 20)}`);
    expect(provider.publicTextLeakPatterns()).toEqual(['x.yupoo.com', 'photo.yupoo.com']);
  });

  it('validates normalized scan and detail evidence at the provider boundary', () => {
    const scan = {
      complete: true,
      taxonomy: [],
      items: [
        {
          albumSourceId: '123',
          publicProductId: 'p_0123456789abcdefabcd',
          sourceUrl: 'https://supplier.x.yupoo.com/albums/123?uid=1',
          listingFingerprint: 'fingerprint'
        }
      ]
    };
    expect(assertCatalogProviderScanResult(scan)).toBe(scan);
    expect(() => assertCatalogProviderScanResult({ complete: true, taxonomy: [], items: [{}] }))
      .toThrow(/catalog_provider_scan_contract_invalid/);

    const detail = {
      name: 'Produto',
      description: '',
      images: [{ sourceUrl: 'https://photo.yupoo.com/supplier/item/full.jpg' }],
      classification: { entityType: 'product' },
      detailFingerprint: 'detail-fingerprint'
    };
    expect(assertCatalogProviderDetailResult(detail)).toBe(detail);
    expect(() => assertCatalogProviderDetailResult({ ...detail, images: [{}] }))
      .toThrow(/catalog_provider_detail_contract_invalid/);
  });

  it('keeps provider-specific parsers out of central ingestion consumers', async () => {
    const files = await Promise.all(
      [
        'worker/ingestion/context.js',
        'worker/ingestion/scan-consumer.js',
        'worker/ingestion/detail-consumer.js',
        'worker/ingestion/finalize-consumer.js',
        'scripts/connect-tenant-source.mjs'
      ].map((path) => readFile(path, 'utf8'))
    );
    const source = files.join('\n');
    expect(source).not.toContain("from './yupoo-listing.js'");
    expect(source).not.toContain("from './yupoo-detail.js'");
    expect(source).not.toContain('verifyYupooSourceUrl');
    expect(source).not.toContain("row.provider !== 'yupoo'");
    expect(source).not.toMatch(/VALUES \(\?1, 'yupoo'/);
    expect(source).not.toContain("LIKE '%x.yupoo.com%'");
  });
});
