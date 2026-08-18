import { describe, expect, it, vi } from 'vitest';
import { publicProductId } from '../scripts/catalog-sync.mjs';
import {
  parseYupooListingHtml,
  scanYupooListingIndex
} from '../worker/ingestion/yupoo-listing.js';

const source = 'https://supplier.x.yupoo.com/albums/';

function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
  });
}

describe('Worker-safe Yupoo listing scanner', () => {
  it('extracts listing evidence without opening an album detail page', () => {
    const rows = parseYupooListingHtml(
      `<ul>
        <li class="album" data-update-time="2026-08-18">
          <a href="/albums/123456" title="Manchester City 2026">
            <img src="//photo.yupoo.com/supplier/example.jpg" />
          </a>
          <span class="photo-count">12 photos</span>
        </li>
      </ul>`,
      source
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: '123456',
      sourceTitle: 'Manchester City 2026',
      imageCountHint: 12,
      coverSourceUrl: 'https://photo.yupoo.com/supplier/example.jpg'
    });
  });

  it('scans a complete root plus category listing with deterministic category assignment', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      calls.push(url.href);
      const page = Number(url.searchParams.get('page') || 1);
      if (page > 1) return htmlResponse('<html><body></body></html>');

      if (url.pathname.startsWith('/categories/10')) {
        return htmlResponse(`
          <html><head><title>Premier League | Supplier</title></head><body>
            <a href="/albums/100" title="Manchester City home"><img src="//photo.yupoo.com/supplier/100.jpg" /></a>
          </body></html>
        `);
      }

      return htmlResponse(`
        <html><body>
          <script>
            window.initial = { categoryData: [{"id":10,"name":"Premier League","parent_id":null}], settings: {} };
          </script>
          <a href="/categories/10">Premier League</a>
          <a href="/albums/100" title="Manchester City home"><img src="//photo.yupoo.com/supplier/100.jpg" /></a>
        </body></html>
      `);
    });

    const scan = await scanYupooListingIndex(source, {
      fetchImpl,
      maxRootPages: 5,
      maxCategoryPages: 5,
      categoryConcurrency: 1
    });

    expect(scan.complete).toBe(true);
    expect(scan.sourceKind).toBe('catalog');
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0]).toMatchObject({
      albumSourceId: '100',
      publicProductId: publicProductId('yupoo', '100'),
      sourceCategoryId: '10',
      sourceCategoryPath: ['10']
    });
    expect(scan.items[0].listingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.some((url) => url.includes('/albums/100?'))).toBe(false);
  });

  it('never follows a listing redirect outside the original Yupoo host', async () => {
    const fetchImpl = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/collect' }
      });

    await expect(
      scanYupooListingIndex(source, { fetchImpl, maxRootPages: 1, maxCategoryPages: 1 })
    ).rejects.toThrow('supplier_redirect_rejected');
  });

  it('supports a single category source without crawling unrelated supplier categories', async () => {
    const categorySource = 'https://supplier.x.yupoo.com/categories/99?isSubCate=true';
    const calls = [];
    const fetchImpl = async (input) => {
      const url = new URL(String(input));
      calls.push(url.href);
      if (url.searchParams.get('page') === '2') return htmlResponse('<html></html>');
      return htmlResponse(`
        <html><head><title>Retro Jerseys | Supplier</title></head><body>
          <a href="/albums/999" title="Retro 1998">Retro 1998</a>
          <a href="/categories/123">Other category</a>
        </body></html>
      `);
    };

    const scan = await scanYupooListingIndex(categorySource, {
      fetchImpl,
      maxRootPages: 3,
      maxCategoryPages: 3
    });
    expect(scan.sourceKind).toBe('category');
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0].sourceCategoryId).toBe('99');
    expect(calls.some((url) => url.includes('/categories/123'))).toBe(false);
  });
});
