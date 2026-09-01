import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  isVirtualKeyboardOpen,
  navKeyAtReadingLine,
  navKeyForSectionId
} from '../src/storefront/mobile-shell.js';

const [html, entry, styles, shellSource] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/mobile-shell.css', 'utf8'),
  readFile('src/storefront/mobile-shell.js', 'utf8')
]);

describe('M9B mobile storefront shell stabilization', () => {
  it('maps the reading sections to one mobile navigation state', () => {
    expect(navKeyForSectionId('inicio')).toBe('home');
    expect(navKeyForSectionId('explorar')).toBe('explore');
    expect(navKeyForSectionId('catalogo')).toBe('products');
    expect(navKeyForSectionId('unknown')).toBe('home');
  });

  it('selects the last section that has crossed the reading line', () => {
    const positions = [
      { id: 'inicio', top: -620 },
      { id: 'explorar', top: -180 },
      { id: 'catalogo', top: 140 }
    ];
    expect(navKeyAtReadingLine(positions, 180)).toBe('products');
    expect(navKeyAtReadingLine(positions, 100)).toBe('explore');
  });

  it('uses the scroll animation frame as the single section-state owner', () => {
    expect(shellSource).toContain('syncSectionFromLayout();');
    expect(shellSource).toContain("window.addEventListener('scroll', scheduleScrollState");
    expect(shellSource).not.toContain('IntersectionObserver');
  });

  it('treats only a material mobile visual-viewport contraction as keyboard-open', () => {
    expect(
      isVirtualKeyboardOpen({ layoutHeight: 844, visualHeight: 560, isMobile: true })
    ).toBe(true);
    expect(
      isVirtualKeyboardOpen({ layoutHeight: 844, visualHeight: 760, isMobile: true })
    ).toBe(false);
    expect(
      isVirtualKeyboardOpen({ layoutHeight: 844, visualHeight: 560, isMobile: false })
    ).toBe(false);
  });

  it('gives every dock action an explicit semantic state key', () => {
    expect(html).toContain('data-mobile-nav="home"');
    expect(html).toContain('data-mobile-nav="explore"');
    expect(html).toContain('data-mobile-nav="search"');
    expect(html).toContain('data-mobile-nav="products"');
  });

  it('loads the shell layer after the luxury storefront layer', () => {
    expect(entry.indexOf("./storefront/mobile-shell.css")).toBeGreaterThan(
      entry.indexOf("./storefront/luxury-mobile.css")
    );
    expect(entry).toContain("./storefront/mobile-shell.js");
  });

  it('reserves iOS safe-area space and removes the dock while the keyboard or product dialog owns the viewport', () => {
    expect(styles).toContain('env(safe-area-inset-bottom, 0px)');
    expect(styles).toContain('env(safe-area-inset-top, 0px)');
    expect(styles).toContain('body.is-keyboard-open .mobile-dock');
    expect(styles).toContain('body:has(#productDialog[open]) .mobile-dock');
    expect(styles).toContain('--ce-visual-viewport-height');
  });
});
