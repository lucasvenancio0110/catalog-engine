import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [entry, main, styles] = await Promise.all([
  readFile('src/entry.js', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/storefront/team-page-filter-density.css', 'utf8')
]);

describe('M9B team page and facet density', () => {
  it('loads the focused team density layer after the existing catalog density layer', () => {
    expect(entry).toContain("import './storefront/catalog-mobile-density.css';");
    expect(entry).toContain("import './storefront/team-page-filter-density.css';");
    expect(entry.indexOf('catalog-mobile-density.css')).toBeLessThan(
      entry.indexOf('team-page-filter-density.css')
    );
  });

  it('enters a club without forcing a catalog scroll', () => {
    expect(main).toContain('function setFilter(next, { scroll = true } = {})');
    expect(main).toContain("setFilter({ teamId: team.team_id }, { scroll: false });");
  });

  it('keeps the selected team facet aligned with the real catalog filter', () => {
    expect(main).toContain("const activeFacetId = state.filters.teamId === view.teamId ? state.filters.facetId || '' : '';");
    expect(main).toContain("button.setAttribute('aria-pressed', String(selected));");
    expect(main).toContain('pressed: !activeFacetId');
    expect(main).toContain('pressed: selected');
    expect(main).toContain('selectTeamFacet(view.teamId, facet.facet_id)');
  });

  it('keeps the phone club header compact, touch-safe and reduced-motion aware', () => {
    expect(styles).toContain(".category-browser[data-view='team'] .category-browser-head");
    expect(styles).toContain("grid-template-areas: 'logo copy back'");
    expect(styles).toContain('min-width: 44px');
    expect(styles).toContain(".facet-card[aria-pressed='true']");
    expect(styles).toContain('min-height: 44px');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
