import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [entry, styles, gallery, main] = await Promise.all([
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/mobile-quick-view.css', 'utf8'),
  readFile('src/product/gallery.js', 'utf8'),
  readFile('src/main.js', 'utf8')
]);

describe('M9B mobile product quick view polish', () => {
  it('loads the quick-view layer after the existing catalog and team density layers', () => {
    expect(entry).toContain("import './storefront/mobile-quick-view.css';");
    expect(entry.indexOf('team-page-filter-density.css')).toBeLessThan(
      entry.indexOf('mobile-quick-view.css')
    );
  });

  it('removes the redundant thumbnail rail only on phone layouts', () => {
    expect(styles).toContain('@media (max-width: 47.99rem)');
    expect(styles).toContain('#productDialog .dialog-thumbs');
    expect(styles).toContain('display: none');
  });

  it('keeps Swiper pagination, keyboard and accessibility as the mobile gallery controls', () => {
    expect(gallery).toContain('A11y, Keyboard, Navigation, Pagination');
    expect(gallery).toContain('keyboard: { enabled: true }');
    expect(gallery).toContain('pagination: { el: pagination, clickable: true }');
    expect(styles).toContain('.swiper-pagination-bullet-active');
  });

  it('keeps touch targets safe and the merchant CTA conditional', () => {
    expect(styles).toContain('width: 44px');
    expect(styles).toContain('height: 44px');
    expect(styles).toContain('.primary-action:not([hidden])');
    expect(main).toContain('els.whatsappButton.hidden = true');
  });

  it('uses compact functional typography and honors reduced motion', () => {
    expect(styles).toContain('font-family: inherit');
    expect(styles).toContain('font-size: clamp(1.12rem, 5.2vw, 1.4rem)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
