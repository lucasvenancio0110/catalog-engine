import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [entry, entityStyles] = await Promise.all([
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/entity-browser-density.css', 'utf8')
]);

describe('M9B mobile entity browser density', () => {
  it('loads the entity density specialization after general discovery density', () => {
    expect(entry).toContain("import './storefront/discovery-density.css';");
    expect(entry).toContain("import './storefront/entity-browser-density.css';");
    expect(entry.indexOf('discovery-density.css')).toBeLessThan(
      entry.indexOf('entity-browser-density.css')
    );
  });

  it('turns country, league and team browsers into one-column phone lists', () => {
    expect(entityStyles).toContain("[data-view='countries']");
    expect(entityStyles).toContain("[data-view='leagues']");
    expect(entityStyles).toContain("[data-view='teams']");
    expect(entityStyles).toContain("[data-view='national-teams']");
    expect(entityStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(entityStyles).toContain('min-height: 64px');
  });

  it('keeps authoritative counts and navigation affordance visible in compact rows', () => {
    expect(entityStyles).toContain('.category-count');
    expect(entityStyles).toContain('.category-arrow');
    expect(entityStyles).toContain('display: grid');
    expect(entityStyles).toContain('width: 18px');
  });

  it('keeps club crests useful without allowing awkward word splitting', () => {
    expect(entityStyles).toContain('.team-mark');
    expect(entityStyles).toContain('width: 44px');
    expect(entityStyles).toContain('word-break: normal');
    expect(entityStyles).toContain('overflow-wrap: normal');
    expect(entityStyles).toContain('-webkit-line-clamp: 2');
  });

  it('provides touch feedback while respecting reduced motion', () => {
    expect(entityStyles).toContain('.category-chip:active');
    expect(entityStyles).toContain('transform: scale(0.985)');
    expect(entityStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(entityStyles).toContain('transform: none');
  });
});
