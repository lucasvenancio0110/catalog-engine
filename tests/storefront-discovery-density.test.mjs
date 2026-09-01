import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [entry, densityStyles] = await Promise.all([
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/discovery-density.css', 'utf8')
]);

describe('M9B mobile discovery density', () => {
  it('loads the density layer after the existing storefront visual layers', () => {
    expect(entry).toContain("import './storefront/compact-hero-search.css';");
    expect(entry).toContain("import './storefront/discovery-density.css';");
    expect(entry.indexOf('compact-hero-search.css')).toBeLessThan(
      entry.indexOf('discovery-density.css')
    );
  });

  it('stacks the root discovery groups while keeping each group horizontally browsable', () => {
    expect(densityStyles).toContain(".category-browser[data-view='root']");
    expect(densityStyles).toContain('background: transparent');
    expect(densityStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(densityStyles).toContain('.featured-clubs .discovery-group-items');
    expect(densityStyles).toContain('.commercial-categories .discovery-group-items');
    expect(densityStyles).toContain('overflow-x: auto');
  });

  it('renders team facets as a compact horizontal touch rail', () => {
    expect(densityStyles).toContain(".category-browser[data-view='team'] .category-chips");
    expect(densityStyles).toContain('display: flex');
    expect(densityStyles).toContain('scroll-snap-type: x proximity');
    expect(densityStyles).toContain(".category-browser[data-view='team'] .facet-card");
    expect(densityStyles).toContain('min-height: 44px');
  });

  it('preserves keyboard focus and reduced-motion behavior', () => {
    expect(densityStyles).toContain('.category-chip:focus-visible');
    expect(densityStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(densityStyles).toContain('transition: none !important');
  });
});
