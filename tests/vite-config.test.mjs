import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.js';

describe('Vite storefront config', () => {
  it('uses a portable relative base', () => {
    expect(viteConfig.base).toBe('./');
  });

  it('builds into dist without Vite publicDir copying', () => {
    expect(viteConfig.publicDir).toBe(false);
    expect(viteConfig.build?.outDir).toBe('dist');
  });

  it('builds separate storefront and customer portal html entries', () => {
    const input = viteConfig.build?.rollupOptions?.input;
    expect(Object.keys(input || {}).sort()).toEqual(['portal', 'storefront']);
    expect(input.storefront.endsWith('/index.html')).toBe(true);
    expect(input.portal.endsWith('/app.html')).toBe(true);
  });

  it('anchors portal-relative bundles to the admin-host root on deep callback routes', async () => {
    const portalHtml = await readFile(new URL('../app.html', import.meta.url), 'utf8');
    expect(portalHtml).toContain('<base href="/" />');
  });
});
