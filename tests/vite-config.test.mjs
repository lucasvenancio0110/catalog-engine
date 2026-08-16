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
});
