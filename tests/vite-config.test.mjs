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
});
