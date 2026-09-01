import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  canLoadNextCatalogPage,
  catalogFeedRange,
  mergeCatalogProductBatch
} from '../src/storefront/catalog-feed.js';

const root = new URL('../', import.meta.url);

describe('storefront incremental catalog feed', () => {
  it('appends only new opaque products while preserving existing order', () => {
    const first = [{ id: 'p_1' }, { id: 'p_2' }];
    const next = [{ id: 'p_2' }, { id: 'p_3' }, { id: 'p_4' }];

    expect(mergeCatalogProductBatch(first, next)).toEqual({
      items: [{ id: 'p_1' }, { id: 'p_2' }, { id: 'p_3' }, { id: 'p_4' }],
      added: [{ id: 'p_3' }, { id: 'p_4' }]
    });
  });

  it('reports an accumulated visible range from the URL start page', () => {
    expect(
      catalogFeedRange({ startPage: 1, pageSize: 15, loadedCount: 45, total: 17089 })
    ).toEqual({ start: 1, end: 45, total: 17089 });

    expect(
      catalogFeedRange({ startPage: 3, pageSize: 15, loadedCount: 30, total: 100 })
    ).toEqual({ start: 31, end: 60, total: 100 });
  });

  it('allows only one healthy next-page request at a time', () => {
    const base = { hasMore: true };
    expect(canLoadNextCatalogPage(base)).toBe(true);
    expect(canLoadNextCatalogPage({ ...base, loading: true })).toBe(false);
    expect(canLoadNextCatalogPage({ ...base, loadingMore: true })).toBe(false);
    expect(canLoadNextCatalogPage({ ...base, error: new Error('initial') })).toBe(false);
    expect(canLoadNextCatalogPage({ ...base, loadMoreError: new Error('next') })).toBe(false);
    expect(canLoadNextCatalogPage({ hasMore: false })).toBe(false);
  });

  it('uses a native prefetch sentinel and keeps public page state as the feed start', async () => {
    const [html, main] = await Promise.all([
      readFile(new URL('../index.html', root), 'utf8'),
      readFile(new URL('../src/main.js', root), 'utf8')
    ]);

    expect(html).toContain('id="catalogLoadMoreSentinel"');
    expect(html).toContain('id="catalogLoadMoreRetry"');
    expect(html).not.toContain('id="previousPage"');
    expect(html).not.toContain('id="nextPage"');
    expect(main).toContain("rootMargin: '600px 0px'");
    expect(main).toContain('const requestSequence = state.requestSequence;');
    expect(main).toContain("writeCatalogHistory('replace', state.feed.startPage)");
    expect(main).not.toContain("writeCatalogHistory('replace', state.pagination.page)");
  });
});
