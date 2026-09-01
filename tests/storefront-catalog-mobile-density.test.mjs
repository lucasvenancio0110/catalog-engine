import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const [entry, densityStyles, enhancer, motionSource] = await Promise.all([
  readFile('src/entry.js', 'utf8'),
  readFile('src/storefront/catalog-mobile-density.css', 'utf8'),
  readFile('src/storefront/luxury-mobile.js', 'utf8'),
  readFile('src/ui/motion.js', 'utf8')
]);

describe('M9B catalog mobile density', () => {
  it('loads the catalog density layer after the shared motion tokens', () => {
    expect(entry).toContain("import './storefront/experience-motion.css';");
    expect(entry).toContain("import './storefront/catalog-mobile-density.css';");
    expect(entry.indexOf('experience-motion.css')).toBeLessThan(
      entry.indexOf('catalog-mobile-density.css')
    );
  });

  it('keeps catalog tools in normal flow instead of the legacy phone overlay', () => {
    expect(densityStyles).toContain('.catalog-tools');
    expect(densityStyles).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(densityStyles).toContain('.clear-catalog-state');
    expect(densityStyles).toContain('position: static');
    expect(densityStyles).toContain("content: 'Limpar'");
    expect(densityStyles).toContain('.catalog-head:has(.clear-catalog-state:not([hidden]))');
    expect(densityStyles).toContain('margin-bottom: 14px');
  });

  it('makes the phone grid product-first and materially shorter', () => {
    expect(densityStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(densityStyles).toContain('aspect-ratio: 0.92 / 1');
    expect(densityStyles).toContain('font-family: var(--ce-font-sans)');
    expect(densityStyles).toContain('-webkit-line-clamp: 2');
    expect(densityStyles).toContain('display: none !important');
  });

  it('uses one accessible product-card action with press feedback on the visual card', () => {
    expect(enhancer).toContain("removeAttribute('role')");
    expect(enhancer).toContain("removeAttribute('tabindex')");
    expect(enhancer).toContain('`Ver detalhes de ${productName}`');
    expect(enhancer).toContain('bindPressFeedback(openButton');
    expect(enhancer).toContain('visualTarget: card');
    expect(densityStyles).toContain(".card[data-density-enhanced='true'] .card-open");
    expect(densityStyles).toContain('position: absolute');
    expect(densityStyles).toContain('inset: 0');
    expect(motionSource).toContain('visualTarget = target');
    expect(motionSource).toContain('animate(\n      visualTarget');
  });

  it('reduces dock chrome while preserving phone-safe touch targets and reduced motion', () => {
    expect(densityStyles).toContain('--ce-mobile-dock-height: 56px');
    expect(densityStyles).toContain('min-height: 46px');
    expect(densityStyles).toContain('min-height: 44px');
    expect(densityStyles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
