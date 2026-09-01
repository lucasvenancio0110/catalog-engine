import { describe, expect, it } from 'vitest';
import worker from '../worker/entry-ui-preview.js';

const env = {
  ASSETS: {
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/app.html')
        return new Response('<title>Catalog Engine — Portal</title><div id="app"></div>');
      return new Response('<title>Catálogo</title><i data-lucide="sun"></i>');
    }
  }
};

async function get(path) {
  return worker.fetch(new Request(`https://preview.example${path}`), env);
}

describe('isolated UI staging worker', () => {
  it('serves a read-only demo catalog without D1 bindings', async () => {
    const health = await (await get('/api/health')).json();
    const meta = await (await get('/api/catalog/meta')).json();
    const products = await (await get('/api/products?page=1&limit=15')).json();

    expect(health).toMatchObject({ ok: true, preview: true, environment: 'ui-staging' });
    expect(meta.store.name).toContain('UI PREVIEW');
    expect(meta.stats.products).toBeGreaterThan(10);
    expect(products.items).toHaveLength(14);
    expect(products.items[0].media[0].url).toMatch(/^data:image\/svg\+xml/);
  });

  it('supports navigation/filter endpoints used by the storefront', async () => {
    const leagues = await (await get('/api/leagues')).json();
    const teams = await (await get('/api/teams?leagueId=laliga&entityType=club')).json();
    const team = await (await get('/api/teams/real-madrid')).json();
    const filtered = await (
      await get('/api/products?teamId=real-madrid&facetId=retro&page=1&limit=15')
    ).json();

    expect(leagues.items.some((entry) => entry.league_id === 'laliga')).toBe(true);
    expect(teams.items.map((entry) => entry.team_id)).toEqual(['real-madrid', 'barcelona']);
    expect(team.facets.some((entry) => entry.facet_id === 'retro')).toBe(true);
    expect(filtered.items.map((entry) => entry.id)).toEqual(['p03']);
  });

  it('applies only bounded storefront sort choices', async () => {
    const ascending = await (await get('/api/products?sort=name-asc&limit=15')).json();
    const invalid = await (await get('/api/products?sort=drop-table&limit=15')).json();
    expect(ascending.sort).toBe('name-asc');
    expect(ascending.items.map((entry) => entry.name)).toEqual(
      ascending.items.map((entry) => entry.name).toSorted((a, b) => a.localeCompare(b))
    );
    expect(invalid.sort).toBe('catalog');
  });

  it('blocks mutation methods and falls back to static assets for UI routes', async () => {
    const mutation = await worker.fetch(
      new Request('https://preview.example/api/products', { method: 'POST' }),
      env
    );
    const storefront = await (await get('/')).text();
    const portal = await (await get('/app.html')).text();

    expect(mutation.status).toBe(405);
    expect(await mutation.json()).toEqual({ error: 'preview_read_only' });
    expect(storefront).toContain('data-lucide="sun"');
    expect(portal).toContain('Catalog Engine — Portal');
  });
});
