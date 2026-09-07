import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const files = Promise.all([
  readFile(new URL('../scripts/cloudflare-trusted-tenant-runtime-stage.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront/merchant-theme.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/storefront/merchant-theme.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/entry.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8')
]);

describe('merchant storefront branding authority', () => {
  it('carries persisted profile theme, colors and opaque logo path into tenant runtime metadata', async () => {
    const [runtimeStage] = await files;
    expect(runtimeStage).toContain('themeKey: String(store.themeKey');
    expect(runtimeStage).toContain('primaryColor:');
    expect(runtimeStage).toContain('secondaryColor:');
    expect(runtimeStage).toContain('logoPath:');
    expect(runtimeStage).toContain("VALUES ('store',?1,CURRENT_TIMESTAMP)");
  });

  it('consumes the current runtime metadata fields instead of the legacy store.theme/store.logo shape', async () => {
    const [, themeModule, , , main] = await files;
    expect(main).toContain("store.theme === 'light'");
    expect(main).toContain('if (store.logo)');
    expect(themeModule).toContain('store?.themeKey');
    expect(themeModule).toContain('store?.primaryColor');
    expect(themeModule).toContain('store?.secondaryColor');
    expect(themeModule).toContain('store?.logoPath');
    expect(themeModule).toContain("root.dataset.storeTheme = branding.themeKey");
    expect(themeModule).toContain("root.style.setProperty('--accent', branding.primaryColor)");
  });

  it('renders each active beta preset as a materially distinct storefront while preserving merchant colors', async () => {
    const [, themeModule, css] = await files;
    expect(themeModule).toContain("'premium-dark': Object.freeze");
    expect(themeModule).toContain('stadium: Object.freeze');
    expect(themeModule).toContain('clean: Object.freeze');
    for (const key of ['premium-dark', 'stadium', 'clean']) {
      expect(css).toContain(`data-store-theme='${key}'`);
    }
    expect(css).toContain('var(--merchant-primary)');
    expect(css).toContain('var(--merchant-secondary)');
  });

  it('loads the merchant theme correction after the existing storefront shell modules', async () => {
    const [, , , entry] = await files;
    expect(entry).toContain("import './storefront/merchant-theme.js';");
    expect(entry.indexOf("import './storefront/merchant-theme.js';")).toBeGreaterThan(
      entry.indexOf("import './main.js';")
    );
  });

  it('keeps branding projection free of tenant/runtime/provider locators', async () => {
    const [, themeModule] = await files;
    expect(themeModule).not.toMatch(/tenantId|databaseId|workerScriptName|dispatchNamespace|sourceLocator|provider_asset/i);
    expect(themeModule).toContain('SAFE_LOGO_PATH');
    expect(themeModule).toContain('brand-assets');
  });
});
