import { describe, expect, it, vi } from 'vitest';
import { yupooIngestionProvider } from '../worker/ingestion/providers/yupoo.js';

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

function album(id) {
  return `<a href="/albums/${id}" title="Produto ${id}"><img src="//photo.yupoo.com/supplier/${id}.jpg" /></a>`;
}

describe('IC3 Yupoo gallery route optimization', () => {
  it('uses gallery rendering for category listing requests without changing source scope flags', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      return htmlResponse(`
        <html><head><title>Categoria | Supplier</title></head><body>
          ${album(9901)}
          <a rel="last" href="/categories/99?isSubCate=true&page=1">Last page</a>
        </body></html>
      `);
    });

    const scan = await yupooIngestionProvider.scanListingIndex(
      'https://supplier.x.yupoo.com/categories/99?isSubCate=true',
      { fetchImpl, maxRootPages: 3, pageConcurrency: 1 }
    );

    expect(scan.complete).toBe(true);
    expect(scan.items).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/categories/99');
    expect(calls[0].searchParams.get('isSubCate')).toBe('true');
    expect(calls[0].searchParams.get('tab')).toBe('gallery');
  });

  it('does not rewrite non-category listing URLs', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      return htmlResponse(`
        <html><body>
          ${album(1001)}
          <a rel="last" href="/albums?page=1">Last page</a>
        </body></html>
      `);
    });

    const scan = await yupooIngestionProvider.scanListingIndex(
      'https://supplier.x.yupoo.com/albums/',
      { fetchImpl, maxRootPages: 3, pageConcurrency: 1 }
    );

    expect(scan.complete).toBe(true);
    expect(scan.items).toHaveLength(1);
    expect(calls[0].pathname).toBe('/albums/');
    expect(calls[0].searchParams.has('tab')).toBe(false);
  });
});
