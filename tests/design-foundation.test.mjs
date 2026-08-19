import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('shared design foundation', () => {
  it('is loaded by both customer-facing surfaces with explicit scope classes', async () => {
    const [storefront, portal] = await Promise.all([read('index.html'), read('app.html')]);

    expect(storefront).toContain('viewport-fit=cover');
    expect(storefront).toContain('body class="ce-storefront"');
    expect(storefront).toContain('href="/src/ui/foundation.css"');

    expect(portal).toContain('viewport-fit=cover');
    expect(portal).toContain('body class="ce-portal"');
    expect(portal).toContain('href="/src/ui/foundation.css"');
  });

  it('defines shared spacing, geometry, responsive and reduced-motion primitives', async () => {
    const css = await read('src/ui/foundation.css');

    for (const token of [
      '--ce-space-1',
      '--ce-space-24',
      '--ce-radius-xs',
      '--ce-radius-full',
      '--ce-control-min',
      '--ce-storefront-max',
      '--ce-portal-max',
      '--ce-grid-gap',
      '--ce-duration-base',
      '--ce-focus-color'
    ]) {
      expect(css).toContain(token);
    }

    expect(css).toContain('.ce-storefront .grid');
    expect(css).toContain('repeat(auto-fill');
    expect(css).toContain('@media (max-width: 47.99rem)');
    expect(css).toContain('@media (min-width: 90rem)');
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('env(safe-area-inset-bottom');
  });

  it('keeps the shared layer brand-neutral', async () => {
    const css = await read('src/ui/foundation.css');

    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toContain('linear-gradient(');
    expect(css).not.toContain('radial-gradient(');
  });
});
