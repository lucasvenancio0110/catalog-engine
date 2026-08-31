import { describe, expect, it } from 'vitest';
import {
  buildCatalogUrl,
  catalogUrlStateLimits,
  hasCatalogRefinement,
  readCatalogUrlState
} from '../src/storefront/catalog-url-state.js';

describe('storefront catalog URL state', () => {
  it('reads bounded public catalog state and defaults invalid pages', () => {
    expect(
      readCatalogUrlState(
        'https://shop.example/?q=%20camisa%20&page=3&teamId=tm_123&leagueId=bad%2Fid&facetId=retro'
      )
    ).toEqual({
      query: 'camisa',
      page: 3,
      filters: { teamId: 'tm_123', leagueId: '', facetId: 'retro' }
    });

    expect(readCatalogUrlState('https://shop.example/?page=-8').page).toBe(1);
  });

  it('serializes only the allowlisted catalog state with a clean first page', () => {
    const next = buildCatalogUrl('https://shop.example/store?private=drop#catalogo', {
      query: ' Brasil ',
      page: 1,
      filters: { teamId: 'tm_bra', leagueId: '', facetId: 'kits', ignored: 'nope' }
    });

    expect(next).toBe('/store?q=Brasil&teamId=tm_bra&facetId=kits#catalogo');
    expect(next).not.toContain('private');
    expect(next).not.toContain('ignored');
  });

  it('bounds query and filter values before they enter history or API state', () => {
    const query = 'x'.repeat(catalogUrlStateLimits.maxQueryLength + 20);
    const filter = 'a'.repeat(catalogUrlStateLimits.maxFilterLength + 1);
    const state = readCatalogUrlState(`https://shop.example/?q=${query}&teamId=${filter}`);

    expect(state.query).toHaveLength(catalogUrlStateLimits.maxQueryLength);
    expect(state.filters.teamId).toBe('');
  });

  it('recognizes search or opaque filters as refinements, but not pagination alone', () => {
    expect(hasCatalogRefinement({ query: '', page: 5, filters: {} })).toBe(false);
    expect(hasCatalogRefinement({ query: 'retro', filters: {} })).toBe(true);
    expect(hasCatalogRefinement({ query: '', filters: { teamId: 'tm_1' } })).toBe(true);
  });
});
