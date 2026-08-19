import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function text(path) {
  return readFile(path, 'utf8');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('M3 iconography and dependency contract', () => {
  it('pins unstable frontend dependencies and adopts Lucide without Fuse', async () => {
    const pkg = JSON.parse(await text('package.json'));
    const lock = JSON.parse(await text('package-lock.json'));
    const policy = JSON.parse(await text('config/dependency-policy.json'));

    expect(pkg.dependencies.lucide).toBe('1.31.0');
    expect(pkg.dependencies.motion).toBe('13.1.0');
    expect(pkg.dependencies.swiper).toBe('14.1.0');
    expect(pkg.devDependencies.vite).toBe('8.2.1');
    expect(pkg.dependencies['fuse.js']).toBeUndefined();

    const specs = [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)];
    expect(specs).not.toContain('latest');

    expect(policy.runtime).toContain('lucide');
    expect(policy.runtime).not.toContain('fuse.js');
    expect(lock.packages[''].dependencies.lucide).toBe('1.31.0');
    expect(lock.packages['node_modules/lucide']?.version).toBe('1.31.0');
    expect(lock.packages['node_modules/fuse.js']).toBeUndefined();
    expect(await exists('src/catalog/search.js')).toBe(false);
  });

  it('uses tree-shaken Lucide packs instead of the all-icons namespace', async () => {
    const storefront = await text('src/ui/storefront-icons.js');
    const portal = await text('src/ui/portal-icons.js');

    for (const source of [storefront, portal]) {
      expect(source).toContain("from 'lucide'");
      expect(source).toContain('createIcons');
      expect(source).not.toMatch(/\bicons\b\s*(?:,|})/);
    }
  });

  it('removes legacy emoji and glyph iconography from customer-facing source', async () => {
    const sources = [
      await text('index.html'),
      await text('src/main.js'),
      await text('src/app/main.js')
    ].join('\n');

    const legacyGlyphs = ['⚽', '🌎', '👕', '🧒', '👩', '👟', '🕰️', '🇧🇷', '🏴', '▦', '◇', '◐', '◎', '◫', '○', '◆'];
    for (const glyph of legacyGlyphs) expect(sources).not.toContain(glyph);

    expect(sources).toContain('data-lucide');
    expect(await text('index.html')).toContain('/src/ui/iconography.css');
    expect(await text('app.html')).toContain('/src/ui/iconography.css');
  });
});
