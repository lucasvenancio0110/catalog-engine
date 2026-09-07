import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyConstructionBatch,
  applyConstructionSeed,
  constructionProjection
} from '../worker/instant-catalog-construction.js';
import { createInitialConstructionPageWriter } from '../worker/ingestion/initial-construction-progress.js';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';

function item(index) {
  const hex = index.toString(16).padStart(20, '0');
  return {
    productId: `p_${hex}`,
    title: `Produto ${index + 1}`,
    listingFingerprint: index.toString(16).padStart(64, '0'),
    sourceItemUrl: `https://supplier.x.yupoo.com/albums/${1000 + index}`,
    cover: {
      mediaId: `cm_${hex}`,
      sourceUrl: `https://photo.yupoo.com/supplier/${1000 + index}.jpg`
    },
    categories: []
  };
}

function seed(start, count, seedHex) {
  return {
    seedId: `cs_${seedHex.repeat(20).slice(0, 20)}`,
    readiness: 'indexed',
    complete: false,
    observedAt: `2026-09-07T04:${String(start % 60).padStart(2, '0')}:00.000Z`,
    items: Array.from({ length: count }, (_unused, index) => item(start + index))
  };
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

describe('IC3 progressive construction batches', () => {
  it('merges page batches idempotently while retaining the existing 48-item construction cap', () => {
    const initial = applyConstructionSeed(null, seed(0, 24, '1'), {
      now: '2026-09-07T04:00:01.000Z'
    });
    const expanded = applyConstructionBatch(initial, seed(20, 24, '2'), {
      now: '2026-09-07T04:20:01.000Z'
    });
    expect(expanded.items).toHaveLength(44);
    expect(expanded.revision).toBe(initial.revision + 1);

    const capped = applyConstructionBatch(expanded, seed(44, 24, '3'), {
      now: '2026-09-07T04:44:01.000Z'
    });
    expect(capped.items).toHaveLength(48);
    expect(constructionProjection(capped, { now: '2026-09-07T04:44:02.000Z' })).toMatchObject({
      readiness: 'indexed',
      ready: true,
      complete: false,
      productCount: 48
    });

    const duplicate = applyConstructionBatch(capped, seed(44, 24, '3'), {
      now: '2026-09-07T04:45:01.000Z'
    });
    expect(duplicate).toEqual(capped);
  });

  it('keeps progressive page evidence behind Provider Engine and emits only the construction seed contract', async () => {
    const source = 'https://supplier.x.yupoo.com/categories/99?isSubCate=true';
    const batches = [];
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get('page') || 1);
      return htmlResponse(`
        <html><body>
          <a href="/albums/${900 + page}" title="Produto ${page}">
            <img src="//photo.yupoo.com/supplier/${900 + page}.jpg" />
          </a>
          ${page === 1 ? '<a rel="last" href="/categories/99?isSubCate=true&page=2">Last page</a>' : ''}
        </body></html>
      `);
    });

    const scan = await yupooIngestionProvider.scanListingIndex(source, {
      fetchImpl,
      maxRootPages: 4,
      pageConcurrency: 2,
      onPageBatch: async (batch) => batches.push(batch)
    });

    expect(scan.complete).toBe(true);
    expect(scan.items).toHaveLength(2);
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.page)).toEqual([1, 2]);
    for (const batch of batches) {
      expect(batch.complete).toBe(false);
      expect(batch.seed).toMatchObject({ readiness: 'indexed', complete: false });
      expect(batch.seed.items).toHaveLength(1);
      expect(batch.seed.items[0].productId).toMatch(/^p_[a-f0-9]{20}$/);
      expect(batch.seed.items[0]).not.toHaveProperty('sourceId');
      expect(batch.seed.items[0]).not.toHaveProperty('albumSourceId');
    }
  });

  it('treats construction-progress write failure as optional UX degradation instead of import failure', async () => {
    const namespace = {
      idFromName(value) {
        return `do:${value}`;
      },
      get() {
        return {
          async fetch() {
            return new Response(JSON.stringify({ error: 'construction_state_unavailable' }), {
              status: 503,
              headers: { 'content-type': 'application/json' }
            });
          }
        };
      }
    };
    const writer = createInitialConstructionPageWriter(
      { TENANT_CONSTRUCTION_STATE: namespace },
      't_0123456789abcdefabcd'
    );
    const result = await writer({ complete: false, seed: seed(0, 12, '4') });
    expect(result).toEqual({ outcome: 'skipped', code: 'construction_state_unavailable' });
  });

  it('binds the scan consumer to the main tenant construction Durable Object without owning its migration', () => {
    const scanConfig = JSON.parse(fs.readFileSync('wrangler.import-scan.jsonc', 'utf8'));
    expect(scanConfig.durable_objects?.bindings).toEqual([
      {
        name: 'TENANT_CONSTRUCTION_STATE',
        class_name: 'TenantConstructionState',
        script_name: 'catalog-engine'
      }
    ]);
    expect(scanConfig.migrations).toBeUndefined();
    expect(scanConfig.workers_dev).toBe(false);
  });

  it('keeps canonical initial-import persistence behind the full complete-scan barrier', () => {
    const source = fs.readFileSync('worker/ingestion/scan-consumer.js', 'utf8');
    const completeAssertion = source.indexOf('assertCatalogProviderScanResult');
    const persist = source.indexOf('persistCompleteListingScan(context, scan');
    expect(completeAssertion).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(completeAssertion);
    expect(source).toContain('createInitialConstructionPageWriter(env, context.tenantId)');
    expect(source).not.toContain('supplier_album_index', source.indexOf('onPageBatch'));
  });
});
