import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [html, entry, styles, shellSource] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/compact-hero-search.css', 'utf8'),
  readFile('src/storefront/mobile-shell.js', 'utf8')
]);

describe('M9B compact hero and dedicated search experience', () => {
  it('keeps one authoritative API-backed search form while exposing multiple search launchers', () => {
    expect((html.match(/id="searchForm"/g) || []).length).toBe(1);
    expect((html.match(/id="searchInput"/g) || []).length).toBe(1);
    expect((html.match(/data-open-search/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('id="searchDialog"');
    expect(html).toContain('form="searchForm"');
  });

  it('separates search from the hero instead of restoring the oversized search row', () => {
    const heroStart = html.indexOf('<section id="inicio" class="hero"');
    const heroEnd = html.indexOf('</section>', heroStart);
    const heroMarkup = html.slice(heroStart, heroEnd);
    expect(heroMarkup).not.toContain('id="searchForm"');
    expect(html.indexOf('class="search-entry"')).toBeGreaterThan(heroEnd);
    expect(styles).toContain("grid-template-areas: 'copy showcase'");
  });

  it('uses neutral catalog copy rather than inventing collection or launch merchandising truth', () => {
    expect(html).toContain('id="heroEyebrow" class="eyebrow hero-eyebrow">CATÁLOGO</p>');
    expect(html).not.toContain('DROP 26/27');
    expect(html).not.toContain('LANÇAMENTO');
    expect(html).not.toContain('Mais vendido');
  });

  it('implements the phone search surface as a safe-area and VisualViewport-aware modal sheet', () => {
    expect(styles).toContain('.search-dialog::backdrop');
    expect(styles).toContain('--ce-visual-viewport-height');
    expect(styles).toContain('env(safe-area-inset-bottom, 0px)');
    expect(styles).toContain('.search-shell--dialog');
    expect(styles).toContain('min-height: 72px');
  });

  it('preserves the existing search owner and only orchestrates opening/focus/closing around it', () => {
    expect(shellSource).toContain("document.querySelector('#searchForm')");
    expect(shellSource).toContain("document.querySelectorAll('[data-open-search]')");
    expect(shellSource).toContain("searchForm?.addEventListener('submit'");
    expect(shellSource).not.toContain('/api/products');
  });

  it('loads the compact experience after the legacy luxury and shell layers', () => {
    const luxuryIndex = entry.indexOf("./storefront/luxury-mobile.css");
    const shellIndex = entry.indexOf("./storefront/mobile-shell.css");
    const compactIndex = entry.indexOf("./storefront/compact-hero-search.css");
    expect(compactIndex).toBeGreaterThan(luxuryIndex);
    expect(compactIndex).toBeGreaterThan(shellIndex);
  });
});
