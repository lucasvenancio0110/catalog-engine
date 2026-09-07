import { describe, expect, it, vi } from 'vitest';
import { publicProductId } from '../scripts/catalog-sync.mjs';
import {
  assertCatalogProviderPreviewSeedObservation,
  CatalogProviderError
} from '../src/catalog-provider/provider-contract.js';
import { resolveCatalogPreviewSeedProvider } from '../worker/ingestion/providers/index.js';
import { previewSeedYupoo } from '../worker/ingestion/yupoo-preview-seed.js';

const source = 'https://supplier.x.yupoo.com/albums/';

function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
  });
}

function listing(count = 16) {
  return `<html><body><ul>${Array.from({ length: count }, (_, index) => {
    const id = 1000 + index;
    return `<li class="album" data-update-time="2026-09-07T03:${String(index).padStart(2, '0')}:00Z">
      <a href="/albums/${id}" title="Produto ${index + 1}">
        <img src="//photo.yupoo.com/supplier/${id}.jpg" />
      </a>
      <span class="photo-count">${index + 2} photos</span>
    </li>`;
  }).join('')}</ul></body></html>`;
}

describe('IC2 Provider Engine preview seed', () => {
  it('returns bounded complete:false L0 evidence from only the first listing page', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input) => {
      calls.push(String(input));
      return htmlResponse(listing(16));
    });

    const seed = await previewSeedYupoo(source, {
      fetchImpl,
      maxItems: 12,
      now: () => new Date('2026-09-07T03:45:00.000Z')
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe(source);
    expect(seed).toMatchObject({
      readiness: 'indexed',
      complete: false,
      observedAt: '2026-09-07T03:45:00.000Z'
    });
    expect(seed.seedId).toMatch(/^cs_[a-f0-9]{20}$/);
    expect(seed.items).toHaveLength(12);
    expect(seed.items[0]).toMatchObject({
      productId: publicProductId('yupoo', '1000'),
      title: 'Produto 1',
      sourceItemUrl: 'https://supplier.x.yupoo.com/albums/1000?uid=1',
      categories: []
    });
    expect(seed.items[0].listingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(seed.items[0].cover.mediaId).toMatch(/^cm_[a-f0-9]{20}$/);
    expect(seed.items[0].cover.sourceUrl).toBe('https://photo.yupoo.com/supplier/1000.jpg');
    expect(() => assertCatalogProviderPreviewSeedObservation(seed)).not.toThrow();
  });

  it('keeps the seed id stable when the same listing is redelivered', async () => {
    const fetchImpl = async () => htmlResponse(listing(12));
    const first = await previewSeedYupoo(source, {
      fetchImpl,
      maxItems: 12,
      now: () => new Date('2026-09-07T03:45:00.000Z')
    });
    const second = await previewSeedYupoo(source, {
      fetchImpl,
      maxItems: 12,
      now: () => new Date('2026-09-07T03:46:00.000Z')
    });

    expect(second.seedId).toBe(first.seedId);
    expect(second.items).toEqual(first.items);
    expect(second.observedAt).not.toBe(first.observedAt);
  });

  it('never follows a preview-seed redirect outside the connected Yupoo host', async () => {
    const fetchImpl = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/collect' }
      });

    await expect(previewSeedYupoo(source, { fetchImpl })).rejects.toThrow(
      /supplier_(?:redirect|url)_rejected/
    );
  });

  it('resolves the optional capability through Provider Engine instead of importing the parser centrally', async () => {
    const provider = resolveCatalogPreviewSeedProvider('yupoo');
    expect(typeof provider.previewSeed).toBe('function');
    expect(() => resolveCatalogPreviewSeedProvider('unknown')).toThrow(CatalogProviderError);
  });

  it('fails closed when a provider tries to label preview evidence as complete authority', () => {
    expect(() =>
      assertCatalogProviderPreviewSeedObservation({
        seedId: 'cs_00000000000000000000',
        readiness: 'indexed',
        complete: true,
        observedAt: '2026-09-07T03:45:00.000Z',
        items: []
      })
    ).toThrow(/catalog_provider_preview_seed_contract_invalid/);
  });
});
